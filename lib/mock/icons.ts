// M1 only: stand-in artwork for mock products, which have no real images.
import { Bluetooth, Headphones, Lightbulb, type LucideIcon, Radio, Waves, Zap } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "1005006123450001": Headphones,
  "1005006123450002": Radio,
  "1005006123450003": Bluetooth,
  "1005006123450004": Zap,
  "1005006123450005": Lightbulb,
  "1005006123450006": Waves,
};

export function mockIconFor(productId: string): LucideIcon {
  return ICONS[productId] ?? Headphones;
}
