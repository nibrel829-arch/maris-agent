import { redirect } from 'next/navigation';

/** Legacy route preserved for existing links. */
export default function LegacyManagerPage() {
  redirect('/manager');
}
