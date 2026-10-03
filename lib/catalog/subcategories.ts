// Our Hebrew names for the second-level AliExpress categories of the catalog's first-level ones
// (lib/catalog/categories.ts), shown as the sub-category pills of a category page. Ids and English
// names from aliexpress.affiliate.category.get (fixtures/aliexpress); the names are ours, never
// AliExpress's machine translation (docs/aliexpress-api.md, Hot products: "חכם אלקטרוניקה").
// Short, as a pill reads. Left out on purpose, so their products fall under "עוד": the catch-all
// "Other ..." groups, and the adult and vaping categories, which a hot list never shows anyway
// (EXCLUDED_CATEGORIES in lib/hot/select.ts). Pure and client-safe.

/** First-level id → (second-level id → Hebrew pill name). */
export const SUBCATEGORY_NAMES_HE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Jewelry & Accessories
  "36": {
    "1509": "תכשיטי אופנה", // Fashion Jewelry
    "200001680": "תכשיטים ממתכות יקרות", // Fine Jewelry
    "201239108": "תכשיטים בהתאמה אישית", // Customized Jewelry
    "200370154": "תכשיטים חכמים", // Smart Jewelry
    "201238105": "ציוד להכנת תכשיטים", // Jewelry Making
    "200001479": "אריזות ומעמדים לתכשיטים", // Jewelry Packaging & Display
    "200001478": "כלים לתכשיטנות", // Jewelry Tools & Equipments
  },
  // Watches
  "1511": {
    "200362146": "שעוני גברים", // Men's Watches
    "200362145": "שעוני נשים", // Women's Watches
    "200362144": "שעוני ילדים", // Children's Watches
    "200362143": "שעונים לזוגות", // Couple Watches
    "200000126": "שעוני כיס", // Pocket & Fob Watches
    "202223401": "שעונים בהתאמה אישית", // Customized Watches
    "200000121": "אביזרים לשעונים", // Watches Accessories
  },
  // Toys & Hobbies
  "26": {
    "200001383": "משחקי בנייה", // Building & Construction Toys
    "200001726": "משחקים ופאזלים", // Games and Puzzles
    "200001385": "צעצועים על שלט", // Remote Control Toys
    "200001388": "צעצועים אלקטרוניים", // Electronic Toys
    "200386159": "צעצועי טכנולוגיה", // High Tech Toys
    "100001714": "צעצועים לימודיים", // Learning & Education
    "100001698": "צעצועים לתינוקות ולפעוטות", // Baby & Toddler Toys
    "200001387": "בובות פרווה", // Stuffed Animals & Plush
    "200001725": "בובות וצעצועים רכים", // Dolls & Stuffed Toys
    "200001389": "בובות ואביזרים", // Dolls & Accessories
    "201292714": "דמויות אקשן", // Action & Toy Figures
    "201534605": "רכבים ודגמים", // Play Vehicles & Models
    "100001716": "משחקי דמיון", // Pretend Play
    "100001715": "צעצועים קלאסיים", // Classic Toys
    "100001719": "משחקי חוץ", // Outdoor Fun & Sports
    "200389159": "בריכות ומשחקי מים", // Pools & Water Fun
    "200389156": "ערכות יצירה", // Arts & Crafts, DIY toys
    "200389146": "מסיבות ילדים", // Kid's Party
    "200246142": "צעצועים להפגת מתח", // Stress Relief Toy
    "200001384": "צעצועי הפתעה ומתיחות", // Novelty & Gag Toys
    "202197601": "קופסאות הפתעה", // Trendy Blind Box
    "200388154": "תחביבים ופריטי אספנות", // Hobby & Collectibles
    "202227409": "מוצרי אנימה ומשחקים", // ACG Goods
  },
  // Mother & Kids
  "1501": {
    "310": "בגדי תינוקות", // Baby Clothing
    "311": "בגדי ילדים", // Children's Clothing
    "200000947": "נעלי ילדים", // Kids Shoes
    "201293501": "אביזרים לילדים", // Kids Accessories
    "200002038": "האכלה", // Feeding
    "200001330": "טיפוח התינוק", // Baby Care
    "200328147": "החתלה וגמילה", // Diapering & Toilet Training
    "201671802": "חיתולים ומגבונים", // Baby Diaper & Wipes
    "200002006": "בטיחות", // Safety
    "200002039": "ציוד ופעילות לתינוק", // Activity & Gear
    "201273175": "עגלות ואביזרים", // Baby Strollers & Accessories
    "200329142": "כיסאות בטיחות לרכב", // Car Seats & Accessories
    "100003020": "מצעים לתינוק", // Bedding
    "200332158": "רהיטים לתינוק", // Baby Furniture
    "201678201": "מעקרים ומכשירים לתינוק", // Baby Sterilization & Appliances
    "200364142": "מזון תינוקות", // Baby Food
    "200332157": "מזכרות לתינוק", // Baby Souvenirs
    "200328149": "הריון ולידה", // Pregnancy & Maternity
    "200000500": "בגדי הריון", // Maternity Clothings
  },
  // Home & Garden
  "15": {
    "200000920": "מטבח והגשה", // Kitchen, Dining & Bar
    "1541": "אחסון וסידור", // Home Storage & Organization
    "200033149": "מוצרים לבית", // Household Merchandises
    "405": "טקסטיל לבית", // Home Textile
    "3710": "עיצוב הבית", // Home Decor
    "125": "גינה", // Garden Supplies
    "100006664": "חיות מחמד", // Pet Products
    "100001824": "מסיבות וחגים", // Festive & Party Supplies
    "200003937": "יצירה ותפירה", // Arts, Crafts & Sewing
    "200003998": "פריטי אספנות", // Collectibles
  },
  // Sports & Entertainment
  "18": {
    "100005371": "כושר", // Fitness & Body Building
    "200003500": "רכיבה על אופניים", // Cycling
    "100005529": "קמפינג וטיולים", // Camping & Hiking
    "100005537": "דיג", // Fishing
    "100005657": "ספורט ימי", // Water Sports
    "200003540": "ענפי מחבט", // Racquet Sports
    "200378143": "ספורט קבוצתי", // Team Sports
    "202220403": "כדורגל", // Football (New)
    "202220404": "כדורסל", // Basketball (New)
    "200003541": "סקייטבורד וגלגיליות", // Roller, Skateboard
    "200003543": "סקי וסנובורד", // Skiing & Snowboarding
    "100005481": "כלי נגינה", // Musical Instruments
    "200003538": "בידור ופנאי", // Entertainment
    "200004217": "תיקי ספורט", // Sports Bags (hidden)
    "100005360": "גולף", // Golf
    "100005551": "רכיבה על סוסים", // Horse Riding
    "100005563": "ציד", // Hunting
    "100005571": "ירי ספורטיבי", // Shooting
    "100005880": "מעודדות", // Cheerleading
    "200297143": "תחרויות ספורט", // Sports Competitions
  },
  // Consumer Electronics
  "44": {
    "200003803": "אלקטרוניקה חכמה", // Smart Electronics
    "100000306": "שמע ווידאו נייד", // Portable Audio & Video
    "100000308": "שמע ווידאו לבית", // Home Audio & Video
    "100000305": "מצלמות וצילום", // Camera & Photo
    "100000310": "משחקי וידאו ואביזרים", // Games & Accessories
    "629": "אביזרים וחלקים", // Accessories & Parts
  },
  // Phones & Telecommunications Accessories
  "202192403": {
    "202228401": "כיסויים לטלפון", // Mobile Phone Cases & Covers
    "202242202": "מגני מסך", // Mobile Phone Protective Film
    "202228620": "מחזיקים ומעמדים", // Holders & Stands
    "100001205": "אביזרים לטלפון", // Mobile Phone Accessories
    "202228601": "אביזרי צילום לטלפון", // Mobile Phone Photography Accessories
    "202229631": "קישוטים לטלפון", // Mobile Phone Decorations
    "200001598": "כרטיסי סים ואביזרים", // Sim Cards & Accessories
  },
  // Computer & Office
  "7": {
    "200001081": "ציוד היקפי", // Computer Peripherals
    "702": "מחשבים ניידים", // Laptops
    "200001083": "חלקים ואביזרים למחשב נייד", // Laptop Parts & Accessories
    "200001086": "טאבלטים", // Tablets
    "200001085": "אביזרים לטאבלט", // Tablet Accessories & Parts
    "701": "מחשבים שולחניים", // Desktops & AIO
    "70803003": "מחשבים זעירים", // Barebone & Mini PC
    "200048142": "מחשבי גיימינג להרכבה", // DIY Gaming Computer
    "200001076": "רכיבי מחשב", // Computer Components
    "200001074": "התקני אחסון", // Storage Device
    "200154144": "אחסון פנימי", // Internal Storage
    "200001077": "ציוד רשת", // Networking
    "200003782": "אלקטרוניקה למשרד", // Office Electronics
    "200003879": "הדפסת תלת־ממד", // 3D Printing & Additive Manufacturing
    "708022": "ניקוי מחשבים", // Computer Cleaners
    "202234201": "מארזי מחשב ומשרד", // Computer & Office Bundle
    "200318143": "תוכנות משרד", // Office Software
    "201610101": "שרתים ומחשבים תעשייתיים", // Servers & Industrial Computer
  },
  // Automobiles, Parts & Accessories
  "34": {
    "200000285": "אלקטרוניקה לרכב", // Car Electronics
    "200003411": "אביזרים לפנים הרכב", // Interior Accessories
    "200003427": "אביזרים חיצוניים", // Exterior Accessories
    "200002005": "תאורה לרכב", // Car Lights
    "200260142": "ניקוי ותחזוקה", // Car Wash & Maintenance
    "200259142": "כלים לתיקון רכב", // Car Repair Tool
    "202229640": "כלי תחזוקה לרכב", // Car Maintenance Tools
    "200000212": "חלקי חילוף", // Auto Replacement Parts
    "201885506": "לרכב חשמלי", // New Energy Vehicle Parts & Accessories
    "201902101": "חלקי שלדה", // Chassis Parts
    "201902201": "מנוע וחלקי מנוע", // Engines & Engine Parts
    "201902301": "ציוד חשמלי לרכב", // Electrical Equipment
    "201902401": "חלקים מתבלים", // Wear Parts
    "201902403": "חלקי מרכב", // Exterior Parts
    "201908801": "חלקי פנים", // Interior Parts
    "201901903": "מערכות נעילה", // Car Lock System
    "201902001": "חיישנים לרכב", // Automotive Sensors
    "202237212": "קרוואנים", // RV Parts & Accessories
    "201268984": "שירותי רכב", // Car Services
    "202245004": "כלי רכב", // Auto Sale
  },
  // Beauty & Health
  "66": {
    "3306": "טיפוח העור", // Skin Care
    "660103": "איפור", // Makeup
    "200001168": "טיפוח ועיצוב שיער", // Hair Care & Styling
    "200001147": "טיפוח ציפורניים", // Nail Art & Tools
    "660302": "גילוח והסרת שיער", // Shaving & Hair Removal
    "201169002": "מכשירי יופי", // Beauty Equipment
    "100000616": "מכשירים לטיפוח העור", // Skin Care Tool
    "200001187": "כלי טיפוח", // Tools & Accessories
    "3305": "היגיינת הפה", // Oral Hygiene
    "200001288": "רחצה", // Bath & Shower
    "200001355": "בריאות", // Health Care
    "201217706": "עיסוי והרפיה", // Massage & Relaxation
    "202236816": "בשמים", // Perfume
    "200001221": "ריחות ודאודורנטים", // Fragrances & Deodorants
    "200001976": "קעקועים ואמנות גוף", // Tattoo & Body Art
    "1513": "מוצרי נייר והיגיינה", // Sanitary Paper
    "201248902": "ציוד דנטלי", // Dental Supplies
    "202188610": "ציוד שיקום", // Rehabilitation Supplies
    "202219877": "ציוד מעבדה רפואי", // Medical Laboratory Equipment
  },
  // Tools
  "1420": {
    "1417": "כלים חשמליים", // Power Tools
    "142003": "כלי עבודה ידניים", // Hand Tools
    "200003955": "ערכות כלים", // Tool Sets
    "1537": "מכשירי מדידה", // Measurement & Analysis Instruments
    "202217001": "מקדחים, להבים וכלי חיתוך", // Drill Bits, Saw Blades & Cutting Tools
    "201252405": "חלקים לכלים חשמליים", // Power Tool Parts & Accessories
    "142001": "חלקים לכלים", // Tool Parts
    "12503": "כלי גינון", // Garden Tools
    "142016": "כלי בנייה", // Construction Tools
    "1427": "חומרי הלחמה", // Welding & Soldering Supplies
    "1440": "ציוד ריתוך", // Welding Equipment & Supplies
    "202216802": "חומרי שיוף", // Abrasive Tools & Abrasives
    "202216201": "חריטת לייזר", // Laser Engraving Machine & Accessories
    "200183146": "מסמרות ומסמררות", // Riveter Guns
    "100007485": "ארגזים ותיקים לכלים", // Tools Packaging
  },
  // Lights & Lighting
  "39": {
    "390501": "תאורת לד", // LED Lighting
    "1504": "תאורה פנימית", // Indoor Lighting
    "150401": "תאורת חוץ", // Outdoor Lighting
    "202255001": "תאורה חכמה", // Smart Lighting
    "390503": "תאורה ניידת", // Portable Lighting
    "39050508": "מנורות לילה", // Night Lights
    "150403": "תאורת חג", // Holiday Lighting
    "202228614": "תאורה מיוחדת", // Novelty Lighting (new)
    "150402": "נורות", // Lighting Bulbs & Tubes
    "530": "אביזרי תאורה", // Lighting Accessories
    "200001704": "תאורה מקצועית", // Professional Light
    "200001493": "תאורה מסחרית", // Commercial Lighting
    "200326144": "תאורה הנדסית", // Special Engineering Lighting
  },
  // Luggage & Bags
  "1524": {
    "201336907": "תיקי נשים", // Women's Handbags
    "201337808": "תיקי גברים", // Men's Bags
    "202236005": "תרמילים", // Backpack
    "3803": "ארנקים ומחזיקים", // Wallets & Holders
    "201298604": "מזוודות", // Luggage
    "152404": "מזוודות ותיקי נסיעה", // Luggage & Travel Bags
    "201294604": "תיקי נסיעות", // Travel Bags
    "201296102": "אביזרי נסיעות", // Travel Accessories
    "201396505": "תיקי מותן", // Waist Packs
    "201401303": "תיקי חזה", // Chest Bags
    "152402": "תיקי מחשב לעבודה", // Business Commuter Laptop Bag
    "380520": "תיקי בית ספר", // School Bags
    "201376929": "תיקי ילדים", // Kids' Bags
    "202235009": "תיקי ארגון", // Organizer Bag
    "3806": "תיקי פנאי", // Leisure Bags
    "3805": "תיקים ייעודיים", // Special Purpose Bags
    "201296801": "תיקי קיץ", // Summer Bags
    "201295902": "תיקי חורף", // Winter Bags
    "152409": "חלקים ואביזרים לתיקים", // Bag Parts & Accessories
  },
  // Home Appliances
  "6": {
    "100000041": "מטבח", // Kitchen Appliances
    "100000038": "ניקוי", // Cleaning Appliances
    "200165142": "טיפוח אישי", // Personal Care Appliances
    "200294142": "מכשירי חשמל ביתיים", // Household Appliances
    "200293142": "מכשירי חשמל גדולים", // Major Appliances
    "100000039": "חלקי חילוף", // Home Appliance Parts
    "200235142": "מכשירים מסחריים", // Commercial Appliances
  },
};

/** The pill of products whose second-level category has no name here (or none at all). */
export const OTHER_SUBCATEGORY = "other";
export const OTHER_SUBCATEGORY_LABEL = "עוד";

/** Our Hebrew name of `subcategoryId` under `firstLevelId`, or null. */
export function subcategoryNameHe(firstLevelId: string, subcategoryId: string): string | null {
  const names = Object.hasOwn(SUBCATEGORY_NAMES_HE, firstLevelId)
    ? SUBCATEGORY_NAMES_HE[firstLevelId]
    : null;
  return names && Object.hasOwn(names, subcategoryId) ? names[subcategoryId] : null;
}
