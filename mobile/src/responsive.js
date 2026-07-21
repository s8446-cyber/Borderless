// Responsive sizing. Phone screens vary from ~320dp (small Androids) to
// ~480dp+ (large phones / tablets). Everything scales from a 390dp design
// reference, clamped so tiny screens stay readable and tablets don't blow up:
//   rs(16)  → 13 on a 320dp screen · 16 at 390dp · 20 max at 480dp+
// CONTENT (maxWidth) keeps the layout a centered phone-width column on
// tablets instead of stretching edge-to-edge. Orientation is portrait-locked
// in app.json, so module-level Dimensions is safe.
import { Dimensions, PixelRatio } from "react-native";

const BASE_WIDTH = 390; // design reference (Pixel 7 / iPhone 14 class)
const MAX_CONTENT_WIDTH = 480;

const w = Math.min(Math.max(Dimensions.get("window").width, 320), MAX_CONTENT_WIDTH);
const factor = w / BASE_WIDTH;

// responsive size: scales dimension/font values with the screen width
export function rs(size) {
  return Math.round(PixelRatio.roundToNearestPixel(size * factor));
}

// container style that keeps content phone-shaped on wide screens
export const CONTENT = {
  width: "100%",
  maxWidth: MAX_CONTENT_WIDTH,
  alignSelf: "center",
};
