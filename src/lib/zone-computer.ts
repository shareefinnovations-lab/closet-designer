export type ReturnWallInput = {
  side: "left" | "right";
  depthIn: number;
  clearanceIn: number;
};

export type DoorOpeningInput = {
  positionFromLeftIn: number;
  widthIn: number;
};

export type ObstacleInput = {
  type: "switch" | "outlet" | "vent" | "window" | "attic_access" | "other";
  positionFromLeftIn: number;
  widthIn: number;
};

export type DesignZone = {
  startIn: number;
  endIn: number;
  usableWidthIn: number;
  maxHeightIn: number;
  sortOrder: number;
};

type BlockedRange = {
  startIn: number;
  endIn: number;
};

function mergeRanges(ranges: BlockedRange[]): BlockedRange[] {
  if (ranges.length === 0) return [];

  const sorted = ranges.sort((a, b) => a.startIn - b.startIn);
  const merged: BlockedRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startIn <= last.endIn) {
      last.endIn = Math.max(last.endIn, current.endIn);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

export function computeDesignZones(params: {
  wallWidthIn: number;
  ceilingHeightIn: number;
  returnWalls: ReturnWallInput[];
  doorOpenings: DoorOpeningInput[];
  obstacles: ObstacleInput[];
}): DesignZone[] {

  const blockedRanges: BlockedRange[] = [];

  for (const rw of params.returnWalls) {
    if (rw.side === "left") {
      blockedRanges.push({
        startIn: 0,
        endIn: rw.depthIn + rw.clearanceIn
      });
    } else {
      blockedRanges.push({
        startIn: params.wallWidthIn - (rw.depthIn + rw.clearanceIn),
        endIn: params.wallWidthIn
      });
    }
  }

  for (const door of params.doorOpenings) {
    blockedRanges.push({
      startIn: door.positionFromLeftIn,
      endIn: door.positionFromLeftIn + door.widthIn
    });
  }

  for (const obstacle of params.obstacles) {
    if (obstacle.type !== "attic_access") {
      blockedRanges.push({
        startIn: obstacle.positionFromLeftIn,
        endIn: obstacle.positionFromLeftIn + obstacle.widthIn
      });
    }
  }

  const merged = mergeRanges(blockedRanges);

  const zones: DesignZone[] = [];
  let cursor = 0;

  for (const blocked of merged) {

    if (blocked.startIn > cursor) {
      zones.push({
        startIn: cursor,
        endIn: blocked.startIn,
        usableWidthIn: blocked.startIn - cursor,
        maxHeightIn: params.ceilingHeightIn,
        sortOrder: zones.length + 1
      });
    }

    cursor = Math.max(cursor, blocked.endIn);
  }

  if (cursor < params.wallWidthIn) {
    zones.push({
      startIn: cursor,
      endIn: params.wallWidthIn,
      usableWidthIn: params.wallWidthIn - cursor,
      maxHeightIn: params.ceilingHeightIn,
      sortOrder: zones.length + 1
    });
  }

  return zones;
}