// Deploy as: supabase/functions/checkout/index.ts
//   supabase functions deploy checkout
//
// Required secrets (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (Supabase auto-injects these)
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//
// This is the ONLY place that ever writes a gift row or uploads a photo.
// The browser never sees the service-role key or the Razorpay key secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const BASE_PRICE_PAISE = 9900; // ₹99 — the only place the real price lives

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function razorpayAuthHeader() {
  return "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
}

// Recompute the price from the discount code ourselves — never trust a
// client-supplied amount.
async function resolveAmount(discountCode?: string) {
  let amountPaise = BASE_PRICE_PAISE;
  let appliedCode: string | null = null;
  let percentOff = 0;
  if (discountCode) {
    const { data } = await sbAdmin
      .from("discount_codes")
      .select("*")
      .eq("code", String(discountCode).toUpperCase())
      .eq("active", true)
      .maybeSingle();
    if (data) {
      appliedCode = data.code;
      percentOff = data.percent_off;
      amountPaise = Math.round(BASE_PRICE_PAISE * (1 - percentOff / 100));
    }
  }
  return { amountPaise, appliedCode, percentOff };
}

async function createOrder(body: any) {
  const { amountPaise, appliedCode, percentOff } = await resolveAmount(body.discount_code);

  if (amountPaise <= 0) {
    return json({ free: true, applied_code: appliedCode, percent_off: percentOff });
  }

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: razorpayAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", payment_capture: 1 }),
  });
  const order = await res.json();
  if (!res.ok) return json({ error: order?.error?.description || "Could not create the order." }, 502);

  return json({
    order_id: order.id,
    amount: amountPaise,
    key_id: RAZORPAY_KEY_ID,
    applied_code: appliedCode,
    percent_off: percentOff,
  });
}

async function uploadPhotoIfAny(photoBase64?: string) {
  if (!photoBase64) return null;
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(photoBase64);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1] || "jpg";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 4_000_000) throw new Error("Photo is too large.");
  const path = `gift-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sbAdmin.storage.from("gift-photos").upload(path, bytes, { contentType: mime });
  if (error) throw error;
  const { data } = sbAdmin.storage.from("gift-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function insertGift(gift: any, paidInfo: Record<string, unknown>) {
  if (!gift?.sender_name || !gift?.dad_name || !gift?.custom_message) {
    throw new Error("Missing gift details.");
  }
  const id = crypto.randomUUID();
  const photo_url = await uploadPhotoIfAny(gift.photo_base64);
  const { error } = await sbAdmin.from("gifts").insert({
    id,
    sender_name: gift.sender_name,
    dad_name: gift.dad_name,
    custom_message: gift.custom_message,
    photo_url,
    paid: true,
    ...paidInfo,
  });
  if (error) throw error;
  return id;
}

async function claimFree(body: any) {
  const { amountPaise, appliedCode, percentOff } = await resolveAmount(body.discount_code);
  if (amountPaise > 0 || percentOff < 100) {
    return json({ error: "That code doesn't make the gift free." }, 400);
  }
  const id = await insertGift(body.gift, { amount_paid: 0, discount_code: appliedCode });
  return json({ gift_id: id });
}

async function verifyAndSave(body: any) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, gift, discount_code } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json({ error: "Missing payment details." }, 400);
  }

  // 1. verify the HMAC signature Razorpay sent back to the browser
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(RAZORPAY_KEY_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${razorpay_order_id}|${razorpay_payment_id}`),
  );
  const expectedSig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expectedSig !== razorpay_signature) {
    return json({ error: "Payment signature didn't check out." }, 400);
  }

  // 2. fetch the order back from Razorpay directly — the authoritative
  //    record of what was actually paid, never the client's word for it
  const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
    headers: { Authorization: razorpayAuthHeader() },
  });
  const order = await orderRes.json();
  if (!orderRes.ok || order.status !== "paid") {
    return json({ error: "Razorpay hasn't marked this order as paid." }, 400);
  }

  const id = await insertGift(gift, {
    amount_paid: order.amount_paid / 100,
    discount_code: discount_code || null,
    razorpay_payment_id,
    razorpay_order_id,
  });
  return json({ gift_id: id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    switch (body.action) {
      case "create_order":
        return await createOrder(body);
      case "claim_free":
        return await claimFree(body);
      case "verify_and_save":
        return await verifyAndSave(body);
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
