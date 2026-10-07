import { redirect } from 'next/navigation';

/** The Manager workspace is the primary operating surface. */
export default function RootPage() {
  redirect('/manager');
}
