import {
  Baby,
  Car,
  CookingPot,
  Dumbbell,
  Flower2,
  Gem,
  Headphones,
  Laptop,
  Lightbulb,
  Luggage,
  PartyPopper,
  PawPrint,
  Smartphone,
  Sparkles,
  ToyBrick,
  WashingMachine,
  Watch,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CatalogIcon as CatalogIconName } from "@/lib/catalog/categories";

const ICONS: Record<CatalogIconName, LucideIcon> = {
  electronics: Headphones,
  phone: Smartphone,
  home: CookingPot,
  decor: Flower2,
  appliances: WashingMachine,
  computer: Laptop,
  car: Car,
  sport: Dumbbell,
  beauty: Sparkles,
  jewelry: Gem,
  watch: Watch,
  bags: Luggage,
  toys: ToyBrick,
  baby: Baby,
  tools: Wrench,
  lighting: Lightbulb,
  events: PartyPopper,
  pets: PawPrint,
};

/**
 * A catalog category's icon (decorative: the name is always next to it). Rendered on the server,
 * also inside the header's category panel, so the icons add no client JavaScript.
 */
export function CatalogIcon({ name, className }: { name: CatalogIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className={className} />;
}
