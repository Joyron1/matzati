// M1 mock of the `deals` table and related content. Admin-managed from M5.
import type { Deal } from "@/lib/types";

export const NEXT_SALE = {
  name: "11.11",
  title_he: "מבצע 11.11 באלי אקספרס",
  starts_at: "2026-11-11T00:00:00+02:00",
};

export const MOCK_DEALS: Deal[] = [
  {
    id: "d1",
    type: "holiday",
    title: "11.11 מתקרב: ככה נערכים",
    body: "שמרו מוצרים בעגלה כבר עכשיו ועקבו אחרי המחיר. חלק מההנחות מתחילות ממחיר שעלה שבוע לפני המבצע.",
    product_id: null,
    coupon_code: null,
    starts_at: "2026-11-11T00:00:00+02:00",
    ends_at: "2026-11-13T23:59:00+02:00",
  },
  {
    id: "d2",
    type: "deal",
    title: "הנחה של 45% על אוזניות ספורט IPX5",
    body: "אוזניות ריצה עם וו אוזן, 96.8% משוב חיובי ו־3,412 מכירות.",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: "2026-10-05T23:59:00+03:00",
  },
  {
    id: "d3",
    type: "dont_buy",
    title: "לא לקנות: כרטיסי זיכרון 1TB שעולים 30 ש״ח",
    body: "נפח כזה במחיר כזה הוא כמעט תמיד זיוף. הכרטיס מדווח על נפח גדול, אבל קבצים נמחקים אחרי שממלאים כמה גיגה.",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: null,
  },
  {
    id: "d4",
    type: "deal",
    title: "אוזניות צוואר מגנטיות בפחות מ־50 ש״ח",
    body: "אפשרות זולה לספורט עם 93.1% משוב חיובי ויותר מ־2,000 מכירות.",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: null,
  },
  {
    id: "d5",
    type: "dont_buy",
    title: "לא לקנות: מטעני קיר בלי סימון תקן",
    body: "מטען שנשאר מחובר לחשמל כל הלילה צריך להיות בטוח. חפשו סימון תקן ברור, ועדיף לשלם עוד קצת.",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: null,
  },
  {
    id: "d6",
    type: "holiday",
    title: "בלאק פריידי באלי אקספרס",
    body: "מבצע נוסף שבועיים אחרי 11.11. אם פספסתם משהו, זו ההזדמנות הבאה.",
    product_id: null,
    coupon_code: null,
    starts_at: "2026-11-27T00:00:00+02:00",
    ends_at: "2026-11-30T23:59:00+02:00",
  },
];
