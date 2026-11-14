import { notFound } from 'next/navigation';
import { Styleguide } from '@/components/styleguide/styleguide';

/** Dev only: every Quiet Ink token and primitive, in both themes. 404 in production builds. */
export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Styleguide />;
}
