// what a hub can report about itself, as words. the Studio does not talk to a hub yet, so nothing calls this with a real
// status. it is the design for when a hub does, built from firmware/docs and untested with hardware.
export interface HubStatus {
  // false when the hub's connection to the server is plain and not encrypted: the development mode
  encrypted?: boolean | undefined;
}

export interface HubNotice {
  headline: string;
  detail: string;
  problem: boolean;
}

export function hubNotices(status: HubStatus | null): HubNotice[] {
  if (!status) return [];
  const out: HubNotice[] = [];
  if (status.encrypted === false) {
    out.push({
      headline: "This hub is in development mode: its connection is not encrypted.",
      detail: "Anyone on your network could read what it sends. The hub shows this as a dim white glow along the whole bar for 2 seconds every 30 seconds. Use it only while building and switch it off before you rely on it.",
      problem: true,
    });
  }
  return out;
}
