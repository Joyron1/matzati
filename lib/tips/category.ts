// Which category a product's tips belong to, and the Hebrew name we show for it. Names are ours
// (not the model's), keyed by AliExpress category id (from aliexpress.affiliate.category.get,
// fixtures/aliexpress). A category without a name here gets a generic heading.
import type { AliProduct } from "@/lib/aliexpress/schemas";

export interface TipsCategory {
  /** category_tips key: the second-level id when the product has one, else the first-level id. */
  id: string;
  /** English name of that category: the model's input, stored as category_en. */
  nameEn: string;
  /** English name of its first-level parent, when `id` is a second-level category. */
  parentEn: string | null;
}

// No tips for these: AliExpress test and non-product categories (gift cards, top-ups, checkout
// links) and adult or vaping products, which have no place on a general shopping page.
const NO_TIPS = new Set([
  "127698009", // Test category 06
  "202192001", // newlv1categorytest
  "200001075", // Special Category
  "201169612", // Virtual Products
  "200003561", // Electronic Cigarettes
  "200001508", // Sex Products
]);

const MAX_NAME = 80;
const cleanName = (name: string | null) =>
  name?.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) || null;

/** The tips category of a product, or null when it has none we write tips for. */
export function tipsCategoryOf(category: AliProduct["category"]): TipsCategory | null {
  const { firstId, secondId } = category;
  const id = secondId ?? firstId;
  if (!id || NO_TIPS.has(id) || (firstId && NO_TIPS.has(firstId))) return null;
  const nameEn = cleanName(secondId ? category.secondName : category.firstName);
  if (!nameEn) return null; // the model needs a name; an id alone says nothing
  return { id, nameEn, parentEn: secondId ? cleanName(category.firstName) : null };
}

/** Hebrew name that reads after "טיפים כלליים לקניית", or null when we have none. */
export function categoryLabelHe(categoryId: string): string | null {
  return Object.hasOwn(LABELS_HE, categoryId) ? LABELS_HE[categoryId] : null;
}

const LABELS_HE: Record<string, string> = {
  // First level
  "2": "מוצרי מזון", // Food
  "3": "ביגוד ואביזרי אופנה", // Apparel & Accessories
  "6": "מכשירי חשמל לבית", // Home Appliances
  "7": "ציוד מחשוב ומשרד", // Computer & Office
  "13": "ציוד לשיפוצים ולתחזוקת הבית", // Home Improvement
  "15": "מוצרים לבית ולגינה", // Home & Garden
  "18": "ציוד ספורט ופנאי", // Sports & Entertainment
  "21": "ציוד משרדי ולבית הספר", // Office & School Supplies
  "26": "צעצועים ומוצרי תחביב", // Toys & Hobbies
  "30": "מוצרי אבטחה ובטיחות", // Security & Protection
  "34": "חלקים ואביזרים לרכב", // Automobiles, Parts & Accessories
  "36": "תכשיטים ואקססוריז", // Jewelry & Accessories
  "39": "מוצרי תאורה", // Lights & Lighting
  "44": "מוצרי אלקטרוניקה", // Consumer Electronics
  "66": "מוצרי טיפוח ובריאות", // Beauty & Health
  "320": "בגדים ואביזרים לאירועים", // Weddings & Events
  "322": "נעליים", // Shoes
  "502": "רכיבים אלקטרוניים", // Electronic Components & Supplies
  "509": "טלפונים ומכשירי תקשורת", // Phones & Telecommunications
  "1420": "כלי עבודה", // Tools
  "1501": "מוצרים לתינוקות ולילדים", // Mother & Kids
  "1503": "רהיטים", // Furniture
  "1511": "שעונים", // Watches
  "1524": "תיקים ומזוודות", // Luggage & Bags
  "200574005": "הלבשה תחתונה", // Underwear
  "201768104": "ביגוד והנעלה לספורט", // Sports Shoes, Clothing & Accessories
  "202192403": "אביזרים לטלפון נייד", // Phones & Telecommunications Accessories
  "200000345": "בגדי נשים", // Women's Clothing
  "200000343": "בגדי גברים", // Men's Clothing
  "200000297": "אביזרי אופנה", // Apparel Accessories
  "200165144": "תוספות שיער ופאות", // Hair Extensions & Wigs
  "202228412": "ספרים", // Books & Cultural Merchandise
  "201355758": "ציוד וחלקים לאופנוע", // Motorcycle Equipments & Parts

  // Consumer Electronics
  "629": "אביזרים וחלקים לאלקטרוניקה", // Accessories & Parts
  "200003803": "מוצרי אלקטרוניקה חכמים", // Smart Electronics
  "100000310": "משחקי וידאו ואביזרים", // Games & Accessories
  "100000306": "מוצרי שמע ווידאו ניידים", // Portable Audio & Video
  "100000305": "מצלמות וציוד צילום", // Camera & Photo
  "100000308": "מערכות שמע ווידאו לבית", // Home Audio & Video

  // Phones & Telecommunications (+ Accessories)
  "5090301": "טלפונים ניידים", // Mobile Phones
  "50906": "מכשירי קשר", // Walkie Talkie
  "201084002": "חלקי חילוף לטלפון נייד", // Mobile Phone Parts
  "202228401": "כיסויים לטלפון", // Mobile Phone Cases & Covers
  "202228620": "מחזיקים ומעמדים לטלפון", // Holders & Stands
  "100001205": "אביזרים לטלפון נייד", // Mobile Phone Accessories
  "202242202": "מגני מסך לטלפון", // Mobile Phone Protective Film
  "202228601": "אביזרי צילום לטלפון", // Mobile Phone Photography Accessories

  // Computer & Office
  "701": "מחשבים שולחניים", // Desktops & AIO
  "702": "מחשבים ניידים", // Laptops
  "200001086": "טאבלטים", // Tablets
  "200001085": "אביזרים לטאבלט", // Tablet Accessories & Parts
  "200001083": "אביזרים וחלקים למחשב נייד", // Laptop Parts & Accessories
  "200001081": "ציוד היקפי למחשב", // Computer Peripherals
  "200001076": "רכיבי מחשב", // Computer Components
  "200001074": "התקני אחסון", // Storage Device
  "200154144": "כונני אחסון פנימיים", // Internal Storage
  "200001077": "ציוד רשת", // Networking
  "200003782": "מכשירים אלקטרוניים למשרד", // Office Electronics
  "200003879": "ציוד להדפסת תלת־ממד", // 3D Printing & Additive Manufacturing
  "70803003": "מחשבים זעירים", // Barebone & Mini PC

  // Home Appliances
  "100000041": "מכשירי חשמל למטבח", // Kitchen Appliances
  "100000038": "מכשירי ניקוי", // Cleaning Appliances
  "200165142": "מכשירי טיפוח חשמליים", // Personal Care Appliances
  "200294142": "מכשירי חשמל לבית", // Household Appliances
  "100000039": "חלקי חילוף למכשירי חשמל", // Home Appliance Parts

  // Home & Garden
  "125": "ציוד לגינה", // Garden Supplies
  "405": "טקסטיל לבית", // Home Textile
  "1541": "מוצרי אחסון וסידור לבית", // Home Storage & Organization
  "3710": "מוצרי עיצוב לבית", // Home Decor
  "200033149": "מוצרים לבית", // Household Merchandises
  "200000920": "כלי מטבח והגשה", // Kitchen, Dining & Bar
  "200003937": "ציוד ליצירה ולתפירה", // Arts, Crafts & Sewing
  "100001824": "ציוד למסיבות ולחגים", // Festive & Party Supplies
  "100006664": "מוצרים לחיות מחמד", // Pet Products

  // Home Improvement
  "5": "ציוד חשמל", // Electrical Equipment & Supplies
  "42": "פרזול", // Hardware
  "200282142": "ציוד אינסטלציה", // Plumbing
  "200066142": "אביזרים לאמבטיה", // Bathroom Fixture
  "200066144": "ברזים ואביזרים למטבח", // Kitchen Fixture
  "200366148": "מוצרי חימום, קירור ואוורור", // Heating, Cooling & Vents
  "200321150": "מוצרים לבית חכם", // Family Intelligence System

  // Sports & Entertainment
  "200003500": "ציוד לרכיבה על אופניים", // Cycling
  "100005529": "ציוד קמפינג וטיולים", // Camping & Hiking
  "100005371": "ציוד כושר", // Fitness & Body Building
  "100005657": "ציוד לספורט ימי", // Water Sports
  "100005537": "ציוד דיג", // Fishing
  "200003540": "ציוד לענפי מחבט", // Racquet Sports
  "200003541": "סקייטבורדים וגלגיליות", // Roller, Skateboard
  "100005481": "כלי נגינה", // Musical Instruments
  "200378143": "ציוד לספורט קבוצתי", // Team Sports
  "200003543": "ציוד סקי וסנובורד", // Skiing & Snowboarding

  // Sports Shoes, Clothing & Accessories
  "301": "בגדי ספורט", // Sportswear
  "200000950": "נעלי ספורט", // Sneakers
  "202228436": "אביזרי ספורט", // Sports Accessories
  "200046142": "תיקי ספורט", // Sport Bags

  // Beauty & Health
  "3305": "מוצרים להיגיינת הפה", // Oral Hygiene
  "3306": "מוצרי טיפוח לעור", // Skin Care
  "660103": "מוצרי איפור", // Makeup
  "660302": "מוצרי גילוח והסרת שיער", // Shaving & Hair Removal
  "201169002": "מכשירי יופי", // Beauty Equipment
  "200001355": "מוצרי בריאות", // Health Care
  "200001288": "מוצרי רחצה", // Bath & Shower
  "200001187": "כלים ואביזרי טיפוח", // Tools & Accessories
  "200001168": "מוצרים לטיפוח ולעיצוב השיער", // Hair Care & Styling
  "200001147": "מוצרים לטיפוח ציפורניים", // Nail Art & Tools
  "201217706": "מכשירי עיסוי", // Massage & Relaxation
  "100000616": "מכשירים לטיפוח העור", // Skin Care Tool

  // Automobiles, Parts & Accessories
  "200000285": "אלקטרוניקה לרכב", // Car Electronics
  "200003411": "אביזרים לפנים הרכב", // Interior Accessories
  "200003427": "אביזרים חיצוניים לרכב", // Exterior Accessories
  "200002005": "תאורה לרכב", // Car Lights
  "200260142": "מוצרי ניקוי ותחזוקה לרכב", // Car Wash & Maintenance
  "200259142": "כלים לתיקון רכב", // Car Repair Tool
  "202229640": "כלים לתחזוקת רכב", // Car Maintenance Tools
  "200000212": "חלקי חילוף לרכב", // Auto Replacement Parts

  // Watches
  "200362146": "שעוני גברים", // Men's Watches
  "200362145": "שעוני נשים", // Women's Watches
  "200362144": "שעוני ילדים", // Children's Watches
  "200000121": "אביזרים לשעונים", // Watches Accessories

  // Toys & Hobbies
  "200001385": "צעצועים על שלט רחוק", // Remote Control Toys
  "200001383": "משחקי בנייה", // Building & Construction Toys
  "200001726": "משחקים ופאזלים", // Games and Puzzles
  "200001388": "צעצועים אלקטרוניים", // Electronic Toys
  "100001714": "צעצועים לימודיים", // Learning & Education
  "100001698": "צעצועים לתינוקות ולפעוטות", // Baby & Toddler Toys
  "200001387": "בובות פרווה", // Stuffed Animals & Plush
  "200001725": "בובות וצעצועים רכים", // Dolls & Stuffed Toys
  "201292714": "דמויות אקשן", // Action & Toy Figures
  "100001719": "משחקי חוץ", // Outdoor Fun & Sports

  // Lights & Lighting
  "1504": "תאורה לבית", // Indoor Lighting
  "150401": "תאורת חוץ", // Outdoor Lighting
  "150402": "נורות", // Lighting Bulbs & Tubes
  "390501": "תאורת לד", // LED Lighting
  "390503": "פנסים ותאורה ניידת", // Portable Lighting
  "202255001": "תאורה חכמה", // Smart Lighting
  "39050508": "מנורות לילה", // Night Lights
  "150403": "תאורה לחגים", // Holiday Lighting

  // Tools
  "1417": "כלי עבודה חשמליים", // Power Tools
  "142003": "כלי עבודה ידניים", // Hand Tools
  "1537": "מכשירי מדידה", // Measurement & Analysis Instruments
  "1427": "ציוד הלחמה", // Welding & Soldering Supplies
  "12503": "כלי גינון", // Garden Tools
  "200003955": "ערכות כלים", // Tool Sets
  "201252405": "אביזרים לכלי עבודה חשמליים", // Power Tool Parts & Accessories

  // Mother & Kids
  "310": "בגדי תינוקות", // Baby Clothing
  "311": "בגדי ילדים", // Children's Clothing
  "201273175": "עגלות תינוק ואביזרים", // Baby Strollers & Accessories
  "200002038": "מוצרי האכלה לתינוקות", // Feeding
  "200002006": "מוצרי בטיחות לילדים", // Safety
  "200329142": "מושבי בטיחות ואביזרים לרכב", // Car Seats & Accessories
  "200001330": "מוצרי טיפוח לתינוקות", // Baby Care
  "200000947": "נעלי ילדים", // Kids Shoes
  "201293501": "אביזרים לילדים", // Kids Accessories

  // Furniture
  "150303": "רהיטים לבית", // Home Furniture
  "150304": "רהיטים למשרד", // Office Furniture
  "150302": "רהיטי גן", // Outdoor Furniture
  "100003019": "רהיטים לילדים", // Children Furniture

  // Luggage & Bags
  "202236005": "תרמילי גב", // Backpack
  "201298604": "מזוודות", // Luggage
  "3803": "ארנקים ומחזיקי כרטיסים", // Wallets & Holders
  "201336907": "תיקי יד לנשים", // Women's Handbags
  "201337808": "תיקים לגברים", // Men's Bags
  "201296102": "אביזרים לנסיעות", // Travel Accessories
  "201294604": "תיקי נסיעות", // Travel Bags
  "152402": "תיקים למחשב נייד", // Business Commuter Laptop Bag
  "380520": "תיקי בית ספר", // School Bags

  // Security & Protection
  "3011": "מצלמות אבטחה", // Video Surveillance
  "202245401": "ציוד בטיחות לחירום", // Emergency Safety Supplies

  // Shoes
  "200133142": "נעלי נשים", // Women's Shoes
  "200131145": "נעלי גברים", // Men's Shoes
  "32210": "אביזרים לנעליים", // Shoe Accessories

  // Jewelry & Accessories
  "1509": "תכשיטי אופנה", // Fashion Jewelry

  // Apparel Accessories
  "200000440": "משקפיים ואביזרים", // Eyewear & Accessories
  "200000402": "כובעים", // Hats & Caps
  "200000298": "חגורות", // Belts
  "200000394": "כפפות", // Gloves & Mittens
  "200000399": "צעיפים", // Scarves & Wraps

  // Office & School Supplies
  "200001743": "כלי כתיבה", // Pens, Pencils & Writing Supplies
  "100003155": "מחברות ופנקסים", // Notebooks & Writing Pads
  "211106": "אביזרים לשולחן העבודה", // Desk Accessories & Organizer
  "211111": "ציוד לאמנות", // Art Supplies
  "100003125": "ציוד לבית הספר", // School Supplies
};
