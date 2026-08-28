import 'server-only';
import { decodeVin } from '@/lib/intake/vin-decode';
import type { ImportPlan, Issue, PlannedRow, VehicleDraft } from './plan';

/**
 * Let the VIN answer the questions the spreadsheet couldn't.
 *
 * THE PROBLEM THIS SOLVES, IN ONE EXAMPLE. The Malabar file has no drivetrain
 * column, so a 2018 Ford Explorer imported with `drivetrain` unset — and the
 * column defaults to `FWD`. An Explorer is rear- or four-wheel drive and has
 * never been front-wheel drive in its life. Nothing errored; we simply
 * published a false fact about a car to every channel, and left a note asking a
 * human to notice. Multiply by twenty-one rows and a dozen fields.
 *
 * The VIN already knows. `decodeVin` is live, free, and caches every result in
 * `vin_decodes` forever, so this is one round trip per VIN ever — a re-import
 * of the same lot costs nothing.
 *
 * THE PRECEDENCE RULE, which is the same one `merge.ts` uses for scanned
 * documents and is worth stating once more here:
 *
 *   **The VIN proves. The file claims.**
 *
 * Year, make, model, body style, doors, engine, cylinders, drivetrain and fuel
 * type are encoded by the manufacturer. Where vPIC has them, they win — not as
 * a tiebreak, outright, because a spreadsheet exported by a third party is a
 * transcription and the VIN is the source.
 *
 * What the VIN cannot know stays the file's: mileage, price, colours, options,
 * description, title. And trim stays the file's too — vPIC offers it at medium
 * confidence and its Series column is full of marketing text, while the file's
 * "Work Truck 4x4 4dr Crew Cab 5 ft. SB" is what the dealer actually advertises.
 *
 * NOT PURE, unlike everything else in this directory: it makes network calls.
 * That is why it is its own file and why `planImport` stays pure — the decision
 * logic can still be tested without a database or a network, and this layer is
 * the only thing that needs either.
 */

export type EnrichReport = {
  /** Rows we successfully decoded. */
  decoded: number;
  /** Of those, answered from `vin_decodes` without touching the network. */
  cached: number;
  /** VINs vPIC could not decode. The row still imports on the file's values. */
  undecoded: number;
  /** Field name → how many rows the VIN filled or corrected. */
  filled: Record<string, number>;
};

/** Warnings the VIN makes obsolete by supplying the value they complained about. */
const RESOLVED_BY: Record<string, string[]> = {
  drivetrain: ['DRIVETRAIN_UNKNOWN'],
  bodyStyle: ['BODY_STYLE_APPROXIMATED'],
};

export async function enrichPlan(plan: ImportPlan): Promise<{
  plan: ImportPlan;
  report: EnrichReport;
}> {
  const report: EnrichReport = { decoded: 0, cached: 0, undecoded: 0, filled: {} };
  const bump = (k: string) => {
    report.filled[k] = (report.filled[k] ?? 0) + 1;
  };

  const rows: PlannedRow[] = [];

  for (const row of plan.rows) {
    if (!row.draft) {
      rows.push(row);
      continue;
    }

    const outcome = await decodeVin(row.draft.vin);
    if (!outcome.ok) {
      // A VIN vPIC does not know is not a reason to drop a car. The file's
      // values stand and its warnings stand with them, which is the honest
      // outcome — we tried the authoritative source and it had nothing.
      report.undecoded += 1;
      rows.push(row);
      continue;
    }

    report.decoded += 1;
    if (outcome.cached) report.cached += 1;

    const e = outcome.extraction;
    const draft: VehicleDraft = { ...row.draft };
    const resolved = new Set<string>();

    /**
     * vPIC's own fields: taken whenever it has them.
     *
     * A CONFIRMATION CLEARS THE WARNING TOO, and that distinction is the whole
     * point. The F-450's body style is the case: the file said "Chassis", which
     * we could only approximate as TRUCK and had to flag as a guess — and vPIC
     * says Truck. The value does not change, but its standing does. It stopped
     * being our guess and became the manufacturer's answer, so the warning
     * asking a human to check it has no reason to survive.
     *
     * `filled` still only counts real changes, because that number is reported
     * to the operator as work the VIN did.
     */
    const take = <K extends keyof VehicleDraft>(key: K, value: VehicleDraft[K] | undefined) => {
      if (value === undefined || value === null) return;
      for (const code of RESOLVED_BY[String(key)] ?? []) resolved.add(code);
      if (draft[key] === value) return;
      draft[key] = value;
      bump(String(key));
    };

    take('drivetrain', e.drivetrain?.value);
    take('doors', e.doors?.value);
    take('cylinders', e.cylinders?.value);
    take('fuelType', e.fuelType?.value);
    take('bodyStyle', e.bodyStyle?.value);
    // Engine only when the file left it blank — the file's string is often the
    // dealer's own wording and reads better on a listing than vPIC's.
    if (!draft.engine && e.engine?.value) take('engine', e.engine.value);

    /*
     * Year, make and model are proved by the VIN too — but a disagreement here
     * is a different animal from a missing drivetrain. It means the row's VIN
     * and the row's description are about two different cars, which is a
     * transcription error in the file or a VIN typed against the wrong line.
     * Correcting it silently would hide the mistake; the dealer needs to know
     * one of the two is wrong before this car goes on sale.
     */
    const issues: Issue[] = row.issues.filter((i) => !resolved.has(i.code));
    const disagreements: string[] = [];
    if (e.year?.value && e.year.value !== draft.year) {
      disagreements.push(`year ${draft.year} → ${e.year.value}`);
    }
    if (e.make?.value && !agrees(e.make.value, draft.make)) {
      disagreements.push(`make "${draft.make}" → "${e.make.value}"`);
    }
    if (e.model?.value && !agrees(e.model.value, draft.model)) {
      disagreements.push(`model "${draft.model}" → "${e.model.value}"`);
    }
    if (disagreements.length) {
      issues.push({
        code: 'VIN_DISAGREES_WITH_FILE',
        severity: 'warning',
        message:
          `The VIN decodes to a different vehicle than the file describes — ${disagreements.join(', ')}. ` +
          'One of the two is wrong; the file’s values were kept.',
      });
    }

    rows.push({ ...row, draft, issues });
  }

  return { plan: { ...plan, rows }, report };
}

/**
 * Do these two describe the same vehicle?
 *
 * Case and punctuation first: vPIC writes "CHEVROLET" where a file writes
 * "Chevrolet", and "F-150" against "F150".
 *
 * Then containment, because vPIC splits a name across columns that a dealer's
 * export concatenates — `Model: "F-450"` with `Series: "Super Duty"` against the
 * file's single "F-450 Super Duty". Reporting that as "the VIN decodes to a
 * different vehicle" is a false alarm, and a false alarm on the one warning that
 * means "these are two different cars" is worse than not having the warning: it
 * is the one an operator must never learn to skip.
 */
function agrees(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return true;
  return x === y || x.includes(y) || y.includes(x);
}
