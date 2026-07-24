export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WindowSize {
    width: number;
    height: number;
}

export function getExpandedBounds(
    anchor: WindowBounds,
    expandedSize: WindowSize,
    workArea: WindowBounds,
): WindowBounds {
    const x = anchor.x + (anchor.width - expandedSize.width) / 2;
    const y = Math.min(anchor.y, workArea.y + workArea.height - expandedSize.height);
    return {x, y, width: expandedSize.width, height: expandedSize.height};
}

export function getCapsuleBounds(anchor: WindowBounds): WindowBounds {
    return {...anchor};
}

export function getAnchorFromExpandedBounds(
    expandedBounds: WindowBounds,
    capsuleSize: WindowSize,
): WindowBounds {
    return {
        x: expandedBounds.x + (expandedBounds.width - capsuleSize.width) / 2,
        y: expandedBounds.y,
        width: capsuleSize.width,
        height: capsuleSize.height,
    };
}
