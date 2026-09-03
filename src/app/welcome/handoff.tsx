'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Client-side hop to the console — see the note in `page.tsx`. */
export function WelcomeHandoff() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin');
  }, [router]);

  return null;
}
