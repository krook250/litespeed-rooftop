// Ported verbatim from just.diy (src/lib/lead-zone.ts), Nov 2026.
/**
 * The time zone a phone number most likely rings in, from its area code, so
 * "texts only 8am to 8pm" means 8am where the lead is, not where the
 * business is. A cell keeps its area code when someone moves, so this is a
 * best guess; callers fall back to the business's zone when it's null.
 *
 * An area code that spans two zones gets the western one: 8am there is 8am
 * or later everywhere in that area code, never 7am. US and Puerto Rico only.
 */

const ZONES: Record<string, string> = {
  "America/New_York": `
    203 475 860 959 302 202 771
    239 305 321 324 352 386 407 448 561 645 656 689 727 754 772 786 813 863 904 941 954
    229 404 470 478 678 706 762 770 912 943
    260 317 463 574 765 502 606 859 207 227 240 301 410 443 667
    339 351 413 508 617 774 781 857 978
    231 248 269 313 517 586 616 679 734 810 947 989 603
    201 551 609 640 732 848 856 862 908 973
    212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934
    252 336 472 704 743 828 910 919 980 984
    216 220 234 283 326 330 380 419 436 440 513 567 614 740 937
    215 223 267 272 412 445 484 570 582 610 717 724 814 835 878
    401 803 839 843 854 864 423 865 802
    276 434 540 571 686 703 757 804 826 948 304 681`,
  "America/Chicago": `
    850 219 812 930 270 364 906 615 629 731 901 931
    205 251 256 334 483 659 938 327 479 501 870
    217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872
    319 515 563 641 712 316 620 785 225 318 337 504 985
    218 320 507 612 651 763 952 228 601 662 769
    314 417 557 573 636 660 816 975 402 531 405 539 572 580 918
    210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979
    262 274 414 534 608 715 920`,
  "America/Denver": `303 719 720 970 983 986 406 505 575 385 435 801 307 308 701 605 915`,
  "America/Phoenix": `480 520 602 623 928`,
  "America/Los_Angeles": `
    208 209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669
    707 714 747 760 805 818 820 831 837 840 858 909 916 925 949 951
    702 725 775 458 503 541 971 206 253 360 425 509 564`,
  "America/Anchorage": `907`,
  "Pacific/Honolulu": `808`,
  "America/Puerto_Rico": `787 939`,
};

const BY_CODE: Record<string, string> = {};
for (const [zone, codes] of Object.entries(ZONES)) for (const c of codes.split(/\s+/)) if (c) BY_CODE[c] = zone;

/** The lead's likely time zone from their number, or null when we can't tell. */
export function zoneForPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? (BY_CODE[ten.slice(0, 3)] ?? null) : null;
}

/* ---- Quiet hours ------------------------------------------------------------ */

/**
 * The hours a text can go out where the lead is, in their local time. The
 * federal rule is 8am to 9pm; some states are stricter. Their state comes from
 * the area code, else the business's state. Not legal advice: when sources
 * disagree on a state, this takes the stricter reading.
 */
export type TextWindow = { open: number; close: number; sundayOpen?: number };

const FEDERAL: TextWindow = { open: 8, close: 21 };
const STRICT: Record<string, TextWindow> = {
  FL: { open: 8, close: 20 }, OK: { open: 8, close: 20 }, MD: { open: 8, close: 20 }, WA: { open: 8, close: 20 },
  OR: { open: 8, close: 20 }, AL: { open: 8, close: 20 }, LA: { open: 8, close: 20 }, MS: { open: 8, close: 20 },
  TN: { open: 8, close: 20 }, UT: { open: 8, close: 20 },
  CT: { open: 9, close: 20 }, NV: { open: 9, close: 21 },
  TX: { open: 9, close: 21, sundayOpen: 12 },
};

const STRICT_CODES: Record<string, string> = {
  FL: "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954",
  OK: "405 539 572 580 918",
  MD: "227 240 301 410 443 667",
  WA: "206 253 360 425 509 564",
  OR: "458 503 541 971",
  AL: "205 251 256 334 483 659 938",
  LA: "225 318 337 504 985",
  MS: "228 601 662 769",
  TN: "423 615 629 731 865 901 931",
  UT: "385 435 801",
  CT: "203 475 860 959",
  NV: "702 725 775",
  TX: "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979",
};
const STATE_BY_CODE: Record<string, string> = {};
for (const [st, codes] of Object.entries(STRICT_CODES)) for (const c of codes.split(/\s+/)) if (c) STATE_BY_CODE[c] = st;

/** When texts can go out for this lead: from their area code, else the business's state. */
export function textWindow(phone: unknown, bizState?: string): TextWindow {
  const d = String(phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  const known = ten.length === 10 && Boolean(BY_CODE[ten.slice(0, 3)]);
  const st = known ? STATE_BY_CODE[ten.slice(0, 3)] : String(bizState ?? "").trim().toUpperCase();
  return (st && STRICT[st]) || FEDERAL;
}

/** "8am to 9pm" for this lead, for the thread. */
export function windowLine(w: TextWindow): string {
  const h = (n: number) => (n === 12 ? "noon" : n < 12 ? `${n}am` : `${n - 12}pm`);
  return `${h(w.open)} to ${h(w.close)}`;
}
