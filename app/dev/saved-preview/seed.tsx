"use client";

// Writes the preview's made-up saved products to this browser's list (development only).
import { useEffect } from "react";
import { readSaved, saveProduct } from "@/lib/saved/mine";

const IMG = "https://ae-pic-a1.aliexpress-media.com/kf/";

const SAMPLES = [
  {
    id: "1005005215319003",
    title: "מארגן כבלים ואוזניות מסיליקון, סט 10 יחידות",
    image: `${IMG}S7b9e52a1027f4e21bf9eb89a4338ee35y.jpg`,
    price: 3.38,
    original: 6.77,
  },
  {
    id: "1005011749334480",
    title: "כבל טעינה מהירה USB-C לאייפון 15-17 וסמסונג, 3 יחידות",
    image: `${IMG}Sc11169d267a6471496c3045d9fe5c3cd2.jpg`,
    price: 7.62,
    original: 15.55,
  },
  {
    id: "1005006861238003",
    title: "קליפסים דביקים לסידור כבלים על השולחן",
    image: `${IMG}S208e59066ea64143963230db82f0e2148.jpg`,
    price: 5.08,
    original: 10.16,
  },
  {
    id: "1005007857247194",
    title: "מטען לרכב 112W עם 3 יציאות לטעינה מהירה",
    image: `${IMG}S143bc1fa2b0048c0926972b4a071f736L.jpg`,
    price: 15.41,
    original: 32.09,
  },
  {
    id: "1005008924358757",
    title: "מחזיק כבלים מסיליקון לשולחן העבודה",
    image: `${IMG}S77915714249b42d583972e4076b2b04dZ.jpg`,
    price: 4.3,
    original: 8.59,
  },
  {
    id: "1005006338829917",
    title: "תיק אחסון עמיד למים לכבלים ואביזרי אלקטרוניקה",
    image: `${IMG}S1054b9147d9e485388688a21f0437e4dL.jpg`,
    price: 15.68,
    original: 31.36,
  },
];

export function SeedSaved() {
  useEffect(() => {
    if (readSaved().length) return;
    for (const p of SAMPLES) saveProduct(p);
  }, []);
  return null;
}
