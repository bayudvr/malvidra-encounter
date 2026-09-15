// Minimal typings for the parts of the W3C Presentation API we use to cast
// the projector view to a Chromecast / smart display. Not in lib.dom yet.

interface PresentationConnection extends EventTarget {
  readonly id: string;
  readonly state: "connecting" | "connected" | "closed" | "terminated";
  close(): void;
  terminate(): void;
}

interface PresentationAvailability extends EventTarget {
  readonly value: boolean;
  onchange: ((this: PresentationAvailability, ev: Event) => unknown) | null;
}

declare class PresentationRequest extends EventTarget {
  constructor(url: string | string[]);
  start(): Promise<PresentationConnection>;
  reconnect(presentationId: string): Promise<PresentationConnection>;
  getAvailability(): Promise<PresentationAvailability>;
}

interface Window {
  PresentationRequest?: typeof PresentationRequest;
}
