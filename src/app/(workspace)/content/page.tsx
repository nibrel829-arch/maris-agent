import { redirect } from 'next/navigation';

/** Legacy content URL preserved for existing links. */
export default function LegacyContentPage() {
  redirect('/marketing');
}
