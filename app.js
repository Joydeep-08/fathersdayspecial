/* ===================================================================
   Father's Day Gift — app logic
   Modes:
     create  -> sender fills the form
     preview -> sender previews exactly what dad will see, then pays
     view    -> dad opens the shared link (?gift=<id>) and just enjoys it
=================================================================== */

// ---------- CONFIG ----------
const SUPABASE_URL = "https://wbfuquzevipaglrddvur.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZnVxdXpldmlwYWdscmRkdnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTgyNjEsImV4cCI6MjA5NzMzNDI2MX0.jawEk2_OGwinPik7mOk5d90B_DMeiwsrT1SsB0CNBdU";

// TODO: replace with your real Razorpay Key ID (Dashboard → Settings → API Keys)
const RAZORPAY_KEY_ID = "rzp_live_Sz9gct8RO5E1jB";

const BASE_PRICE_RUPEES = 99;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#F3E1D8"/><text x="50%" y="54%" font-size="64" text-anchor="middle" dominant-baseline="middle">💛</text></svg>`
  );

// ---------- STATE ----------
const state = {
  mode: "create", // create | preview | view
  senderName: "",
  dadName: "",
  customMessage: "",
  photoFile: null,
  photoUrl: null,
  giftId: null,
  finalAmount: BASE_PRICE_RUPEES,
  discountCode: null,
};

// ---------- SMALL HELPERS ----------
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  $("progressDots").style.display = ["screen-p1", "screen-p2", "screen-p3", "screen-p4"].includes(id)
    ? "flex"
    : "none";
}

function setProgress(step) {
  document.querySelectorAll(".progress .dot").forEach((dot) => {
    const s = Number(dot.dataset.step);
    dot.classList.toggle("current", s === step);
    dot.classList.toggle("done", s < step);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function genId() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // fallback uuid v4 for contexts without crypto.randomUUID (e.g. non-HTTPS)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function spawnPetals() {
  const field = $("petalField");
  const colors = ["#E8B4A0", "#C97B86", "#B6A6C9"];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement("div");
    p.className = "petal";
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 14 + "s";
    p.style.animationDuration = 10 + Math.random() * 10 + "s";
    field.appendChild(p);
  }
}

function confettiBurst(originEl, colors) {
  const rect = originEl.getBoundingClientRect();
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.pointerEvents = "none";
  host.style.zIndex = "999";
  document.body.appendChild(host);
  for (let i = 0; i < 14; i++) {
    const bit = document.createElement("div");
    bit.className = "confetti-bit";
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 60;
    bit.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    bit.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    bit.style.setProperty("--rot", Math.random() * 360 + "deg");
    bit.style.background = colors[i % colors.length];
    bit.style.left = rect.left + rect.width / 2 + "px";
    bit.style.top = rect.top + rect.height / 2 + "px";
    bit.style.position = "fixed";
    host.appendChild(bit);
  }
  setTimeout(() => host.remove(), 800);
}

// ---------- BALLOON FACTORY ----------
function balloonSvgMarkup(color) {
  return `
  <svg class="balloon-svg" width="100" height="160" viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="58" rx="42" ry="50" fill="${color}"/>
    <ellipse cx="36" cy="38" rx="12" ry="16" fill="#ffffff" opacity="0.25"/>
    <polygon points="44,104 56,104 50,116" fill="${color}"/>
    <path d="M50 116 C 60 130, 40 140, 50 160" stroke="#C9B8AE" stroke-width="2" fill="none"/>
  </svg>`;
}

/**
 * Creates a balloon inside containerEl. Calls onPop(wrapEl) once, on first tap.
 */
function makeBalloon(containerEl, color) {
  const wrap = document.createElement("div");
  wrap.className = "balloon-wrap";
  wrap.innerHTML = balloonSvgMarkup(color);
  containerEl.appendChild(wrap);
  return wrap;
}

function popBalloon(wrap, color, onDone) {
  if (wrap.classList.contains("popped")) return;
  wrap.classList.add("popped", "pop-anim");
  confettiBurst(wrap, [color, "#ffffff"]);
  setTimeout(() => {
    wrap.style.visibility = "hidden";
    if (onDone) onDone();
  }, 320);
}

// ---------- COPY GENERATION ----------
function letterBody(dadName, senderName) {
  return `Thank you for the quiet sacrifices, the steady hands, and the lessons you never made a big deal of. Every ride to nowhere in particular, every time you simply stayed — it shaped who I am today. ${escapeHtml(
    senderName
  )} just wanted you to know, today and always, how loved and appreciated you are, ${escapeHtml(dadName)}.`;
}

// ---------- POPULATE CONTENT ----------
function populateContent() {
  const { dadName, senderName, customMessage, photoUrl } = state;

  $("introDadName").textContent = dadName;
  $("introFromName").textContent = "from " + senderName;

  $("p1Headline").textContent = "Make a wish, " + dadName;
  $("wishFromLine").textContent = "From " + senderName + ", with love.";

  $("p2Caption").textContent = "A little memory from " + senderName;
  $("p2PhotoImg").src = photoUrl || DEFAULT_PHOTO;

  $("p3Greeting").textContent = "Dear " + dadName + ",";
  $("p3Body").innerHTML = letterBody(dadName, senderName);
  $("p3Signature").textContent = "With all my heart, " + senderName;

  $("p4CustomText").textContent = customMessage;
  $("p4Signature").textContent = "— " + senderName;

  $("paymentHeadline").textContent = "Send this to " + dadName;
  $("btnPay").textContent = "Pay ₹" + BASE_PRICE_RUPEES + " & get link";
  $("basePriceLabel").textContent = "₹" + BASE_PRICE_RUPEES;
  $("totalPriceLabel").textContent = "₹" + BASE_PRICE_RUPEES;
  $("successDadName").textContent = dadName;
}

// ---------- PAGE RESET / BUILD ----------
function resetPage1() {
  $("candleFlame").classList.remove("out");
  $("candleSmoke").classList.remove("rise");
  $("wishResult").classList.remove("show");
  $("candleHint").style.display = "block";
}

function resetPage2() {
  $("p2BalloonHolder").innerHTML = "";
  $("p2PhotoReveal").classList.remove("show");
  $("p2Caption").classList.remove("show");
  $("btnToP3").style.display = "none";
  const balloon = makeBalloon($("p2BalloonHolder"), "#E8B4A0");
  balloon.addEventListener("click", () => {
    popBalloon(balloon, "#E8B4A0", () => {
      $("p2PhotoReveal").classList.add("show");
      $("p2Caption").classList.add("show");
      $("btnToP3").style.display = "inline-block";
    });
  });
}

const PAGE4_WORDS = ["You", "are", "my", "hero"];
const PAGE4_COLORS = ["#93AC82", "#B6A6C9", "#C97B86", "#E3A47E"];

function resetPage4() {
  $("p4BalloonGrid").innerHTML = "";
  $("p4FinalMessage").classList.remove("show");
  $("btnToPayment").style.display = "none";
  $("btnReplay").style.display = "none";
  const wordBar = $("wordBar");
  wordBar.innerHTML = PAGE4_WORDS.map(() => '<span class="blank">_____</span>').join("");

  let poppedCount = 0;
  PAGE4_WORDS.forEach((word, i) => {
    const balloon = makeBalloon($("p4BalloonGrid"), PAGE4_COLORS[i]);
    balloon.addEventListener("click", () => {
      popBalloon(balloon, PAGE4_COLORS[i], () => {
        const slot = wordBar.children[i];
        slot.textContent = word;
        slot.classList.remove("blank");
        poppedCount++;
        if (poppedCount === PAGE4_WORDS.length) {
          $("p4FinalMessage").classList.add("show");
          if (state.mode === "preview") {
            $("btnToPayment").style.display = "inline-block";
          } else {
            $("btnReplay").style.display = "inline-block";
          }
        }
      });
    });
  });
}

function resetAllPages() {
  resetPage1();
  resetPage2();
  resetPage4();
}

// ---------- NAVIGATION WIRING ----------
$("candleFlame").addEventListener("click", () => {
  if ($("candleFlame").classList.contains("out")) return;
  $("candleFlame").classList.add("out");
  $("candleSmoke").classList.add("rise");
  $("candleHint").style.display = "none";
  setTimeout(() => $("wishResult").classList.add("show"), 350);
});

$("btnToP2").addEventListener("click", () => {
  showScreen("screen-p2");
  setProgress(2);
});
$("btnToP3").addEventListener("click", () => {
  showScreen("screen-p3");
  setProgress(3);
});
$("btnToP4").addEventListener("click", () => {
  showScreen("screen-p4");
  setProgress(4);
});
$("btnOpenGift").addEventListener("click", () => {
  showScreen("screen-p1");
  setProgress(1);
});
$("btnReplay").addEventListener("click", () => {
  resetAllPages();
  showScreen("screen-intro");
});
$("btnToPayment").addEventListener("click", () => {
  showScreen("screen-payment");
});

// ---------- FORM (create mode) ----------
$("inputMessage").addEventListener("input", (e) => {
  $("msgCount").textContent = e.target.value.length;
});

$("inputPhoto").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.photoFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    $("photoPreviewImg").src = reader.result;
    $("photoPreviewImg").style.display = "block";
    $("photoPlaceholder").style.display = "none";
  };
  reader.readAsDataURL(file);
});

$("btnGoPreview").addEventListener("click", async () => {
  const sender = $("inputSender").value.trim();
  const dad = $("inputDad").value.trim();
  const message = $("inputMessage").value.trim();
  const errEl = $("formError");
  errEl.textContent = "";

  if (!sender || !dad || !message) {
    errEl.textContent = "Please fill in your name, dad's name, and a short message.";
    return;
  }

  state.senderName = sender;
  state.dadName = dad;
  state.customMessage = message;

  const btn = $("btnGoPreview");
  btn.disabled = true;
  btn.textContent = "Getting things ready…";

  try {
    // upload photo if one was chosen
    if (state.photoFile) {
      const ext = (state.photoFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = `gift-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadErr } = await sb.storage.from("gift-photos").upload(path, state.photoFile);
      if (uploadErr) throw uploadErr;
      const { data: pub } = sb.storage.from("gift-photos").getPublicUrl(path);
      state.photoUrl = pub.publicUrl;
    }

    // create draft gift row — we generate the id ourselves so we never need
    // to read the row back (a fresh unpaid row isn't publicly readable, by design)
    const newId = genId();
    const { error } = await sb.from("gifts").insert({
      id: newId,
      sender_name: state.senderName,
      dad_name: state.dadName,
      custom_message: state.customMessage,
      photo_url: state.photoUrl,
      paid: false,
    });
    if (error) throw error;

    state.giftId = newId;
    state.mode = "preview";

    populateContent();
    resetAllPages();
    showScreen("screen-intro");
  } catch (err) {
    console.error(err);
    errEl.textContent = "Something went wrong saving your gift" + (err && err.message ? ": " + err.message : ". Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Preview the gift →";
  }
});

// ---------- DISCOUNT CODE ----------
$("btnApplyDiscount").addEventListener("click", async () => {
  const codeInput = $("inputDiscount").value.trim().toUpperCase();
  const msgEl = $("discountMsg");
  msgEl.className = "discount-msg";
  msgEl.textContent = "";
  if (!codeInput) return;

  try {
    const { data, error } = await sb
      .from("discount_codes")
      .select("*")
      .eq("code", codeInput)
      .eq("active", true)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      msgEl.classList.add("err");
      msgEl.textContent = "That code isn't valid or has expired.";
      $("discountSummaryRow").style.display = "none";
      state.discountCode = null;
      state.finalAmount = BASE_PRICE_RUPEES;
      $("totalPriceLabel").textContent = "₹" + BASE_PRICE_RUPEES;
      $("btnPay").textContent = "Pay ₹" + BASE_PRICE_RUPEES + " & get link";
      return;
    }

    const discountAmt = Math.round((BASE_PRICE_RUPEES * data.percent_off) / 100);
    const finalAmount = Math.max(BASE_PRICE_RUPEES - discountAmt, 1);
    state.discountCode = data.code;
    state.finalAmount = finalAmount;

    $("discountSummaryRow").style.display = "flex";
    $("discountLabel").textContent = `Discount (${data.code})`;
    $("discountAmountLabel").textContent = "−₹" + discountAmt;
    $("totalPriceLabel").textContent = "₹" + finalAmount;
    $("btnPay").textContent = "Pay ₹" + finalAmount + " & get link";

    msgEl.classList.add("ok");
    msgEl.textContent = `Applied! ${data.percent_off}% off.`;
  } catch (err) {
    console.error(err);
    msgEl.classList.add("err");
    msgEl.textContent = "Couldn't check that code right now.";
  }
});

// ---------- PAYMENT ----------
$("btnPay").addEventListener("click", () => {
  const errEl = $("paymentError");
  errEl.textContent = "";

  if (!window.Razorpay) {
    errEl.textContent = "Payment couldn't load. Check your connection and try again.";
    return;
  }
  if (RAZORPAY_KEY_ID.includes("REPLACE_ME")) {
    errEl.textContent = "Razorpay isn't configured yet — add your Key ID in app.js.";
    return;
  }

  const options = {
    key: RAZORPAY_KEY_ID,
    amount: state.finalAmount * 100,
    currency: "INR",
    name: "A Father's Day Gift",
    description: "For " + state.dadName,
    theme: { color: "#8B4452" },
    handler: async function (response) {
      try {
        const { error } = await sb
          .from("gifts")
          .update({
            paid: true,
            amount_paid: state.finalAmount,
            discount_code: state.discountCode,
            razorpay_payment_id: response.razorpay_payment_id,
          })
          .eq("id", state.giftId);
        if (error) throw error;

        const link = `${location.origin}${location.pathname}?gift=${state.giftId}`;
        $("giftLinkInput").value = link;
        $("successDadName").textContent = state.dadName;
        if (navigator.share) {
          $("btnShare").style.display = "inline-block";
        }
        showScreen("screen-success");
      } catch (err) {
        console.error(err);
        errEl.textContent = "Payment went through, but saving the link failed. Contact support with payment ID " + response.razorpay_payment_id + ".";
      }
    },
    modal: { ondismiss: function () {} },
  };

  const rzp = new Razorpay(options);
  rzp.open();
});

$("btnCopyLink").addEventListener("click", async () => {
  const input = $("giftLinkInput");
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    $("btnCopyLink").textContent = "Copied!";
    setTimeout(() => ($("btnCopyLink").textContent = "Copy"), 1500);
  } catch {
    /* clipboard not available — selection still lets the user copy manually */
  }
});

$("btnShare").addEventListener("click", () => {
  navigator.share({
    title: "A Father's Day gift",
    text: "I made you something for Father's Day 💛",
    url: $("giftLinkInput").value,
  }).catch(() => {});
});

$("btnCreateAnother").addEventListener("click", () => {
  location.href = location.pathname;
});

// ---------- INIT: decide create vs view mode ----------
async function init() {
  spawnPetals();

  const params = new URLSearchParams(location.search);
  const giftId = params.get("gift");

  if (!giftId) {
    state.mode = "create";
    showScreen("screen-form");
    return;
  }

  showScreen("screen-loading");
  try {
    const { data, error } = await sb.from("gifts").select("*").eq("id", giftId).eq("paid", true).maybeSingle();
    if (error) throw error;
    if (!data) {
      $("errorDetail").textContent = "This gift isn't ready yet — ask the sender to finish creating it.";
      showScreen("screen-error");
      return;
    }
    state.mode = "view";
    state.senderName = data.sender_name;
    state.dadName = data.dad_name;
    state.customMessage = data.custom_message;
    state.photoUrl = data.photo_url;
    state.giftId = data.id;

    populateContent();
    resetAllPages();
    showScreen("screen-intro");
  } catch (err) {
    console.error(err);
    $("errorDetail").textContent = "Something went wrong loading this gift. Please ask the sender for a fresh link.";
    showScreen("screen-error");
  }
}

init();