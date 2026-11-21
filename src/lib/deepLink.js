// limecore#127 — StudyDesk's router deep links, for the launcher shortcuts and
// for the other suite apps (NCC#131 links into these):
//
//   com.studydesk.app://open/today
//   com.studydesk.app://open/plan            (?add=assignment opens Add Assignment)
//   com.studydesk.app://open/timer           (?start=focus starts a focus block)
//   com.studydesk.app://open/course/<id>
//
// Any app can open a link, so a link only ever NAVIGATES (or opens a form, or
// starts the user's own focus timer). It never changes or reveals data, and a
// course id the device does not hold falls back to Plan. The scheme is
// lowercase: Android matches it case-sensitively (see AndroidManifest.xml).

const PREFIX = 'com.studydesk.app://open/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The route a URL names, or null for anything that is not one of ours. */
export function parseRoute(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith(PREFIX)) return null;
  const rest = url.slice(PREFIX.length);
  const [path, query = ''] = rest.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const params = new URLSearchParams(query);
  switch ((parts[0] || '').toLowerCase()) {
    case 'today': return { view: 'today' };
    case 'plan': return { view: 'plan', addAssignment: params.get('add') === 'assignment' };
    case 'timer': return { view: 'timer', startFocus: params.get('start') === 'focus' };
    case 'course': return parts[1] && UUID_RE.test(parts[1]) ? { view: 'course', courseId: parts[1].toLowerCase() } : { view: 'plan', addAssignment: false };
    default: return null;
  }
}
