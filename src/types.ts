/** A single point in inches */
export interface Point {
  x: number;
  y: number;
}

/** A tool outline extracted from an image */
export interface ToolOutline {
  id: string;
  name: string;
  /** Contour points in inches, relative to the tool's own origin */
  contour: Point[];
  /** Width in inches */
  widthInches: number;
  /** Height in inches */
  heightInches: number;
}

/** A placed tool on the board */
export interface PlacedTool {
  id: string;
  outline: ToolOutline;
  /** Position of top-left corner on the board, in inches */
  x: number;
  y: number;
  /** Rotation in degrees */
  rotation: number;
}

/** Board dimensions */
export const BOARD_WIDTH_INCHES = 27;
export const BOARD_HEIGHT_INCHES = 20;
