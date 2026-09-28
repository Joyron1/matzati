// Single source for the brand. The owner may rename the product later.
import { RESULTS_PER_PAGE } from "./site";

export const BRAND = {
  name: "מצאתי",
  nameLatin: "Matzati",
  tagline: "עוזר קניות חכם לאלי אקספרס",
  description: `כתבו בעברית מה אתם צריכים וקבלו ${RESULTS_PER_PAGE} מוצרים מאלי אקספרס שעברו סינון לפי משוב של קונים ומספר מכירות.`,
  // Public WhatsApp channel link. Empty until the owner creates the channel.
  whatsappChannelUrl: "",
} as const;
