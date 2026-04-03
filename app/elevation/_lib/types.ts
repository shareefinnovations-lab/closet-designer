// ─── Shared Types ─────────────────────────────────────────────────────────────

export type View = "front" | "top";
export type ComponentType = "Shelf" | "DrawerStack" | "Rod";

export interface ClosetComponent {
  id: number;
  type: ComponentType;
  // Distance in inches from section TOP to the TOP of this component.
  positionIn: number;
  // Per-drawer heights — only for DrawerStack. Empty array for Shelf/Rod.
  drawerHeights: number[];
}

export interface Section {
  widthIn: number;
  depthIn: number;
  components: ClosetComponent[];
}

export interface Config {
  clientName:      string;
  clientNum:       string;
  locationName:    string;
  wallWidthIn:     number;
  ceilingHeightIn: number;
  closetDepthIn:   number;
  leftReturnIn:    number;
  rightReturnIn:   number;
  remarks:         string;
  projectType?:    string;  // set from dashboard: Reach-In Closet, Walk-In Closet, Garage, etc.
}
