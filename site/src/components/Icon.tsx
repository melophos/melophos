import { iconMarkup, type IconName } from "../../../studio/src/icons/index.ts";

// the Studio's own icon set, drawn into the page at build time. the wrapper adds no box of its own
export function Icon({ name }: { name: IconName }) {
  return <span className="icon-host" dangerouslySetInnerHTML={{ __html: iconMarkup(name) }} />;
}
