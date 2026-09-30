// Single source for the brand. The owner may rename the product later.
import { RESULTS_FIRST_VIEW } from "./site";

export const BRAND = {
  name: "מצאתי",
  nameLatin: "Matzati",
  tagline: "עוזר קניות חכם לאלי אקספרס",
  description: `כתבו בעברית מה אתם צריכים וקבלו ${RESULTS_FIRST_VIEW} מוצרים מאלי אקספרס שעברו סינון לפי משוב של קונים ומספר מכירות.`,
  // Public WhatsApp channel link. Empty until the owner creates the channel.
  whatsappChannelUrl: "",
} as const;
