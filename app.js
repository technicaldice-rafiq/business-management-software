JavaScript

/* Business Management Software
   Uses Supabase Auth and database.
*/

(() => {
  "use strict";

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  const $ = (id) => document.getElementById(id);

  let currentUser = null;
  let currentBusiness = null;
  let isSuperAdmin = false;

  function showMessage(message, isError = false) {
    const box = $("message");
    box.textContent = message;
    box.classList.remove("hidden", "error");
    if (isError) box.classList.add("error");
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearMessage() {
    $("message").classList.add("hidden");
    $("message").textContent = "";
    $("message").classList.remove("error");
  }

  function readableError(error) {
    console.error(error);
    return error?.message || "সমস্যা হয়েছে। আবার চেষ্টা করুন।";
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button[type="submit"]').forEach((button) => {
      button.disabled = busy;
    });
  }

  function showLoginTab(tab) {
    const login = tab === "login";
    $("loginForm").classList.toggle("hidden", !login);
    $("signupForm").classList.toggle("hidden", login);
    $("loginTab").classList.toggle("active", login);
    $("signupTab").classList.toggle("active", !login);
    clearMessage();
  }

  $("loginTab").addEventListener("click", () => showLoginTab("login"));
  $("signupTab").addEventListener("click", () => showLoginTab("signup"));

  function showAuthenticatedScreen() {
    $("authSection").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
  }

  function showUnauthenticatedScreen() {
    currentUser = null;
    currentBusiness = null;
    isSuperAdmin = false;

    $("authSection").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
    $("adminPanel").classList.add("hidden");
  }

  async function findBusiness() {
    const { data, error } = await client
      .from("bms_businesses")
      .select("*")
      .eq("owner_id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    currentBusiness = data;
    return data;
  }

  async function checkAdmin() {
    const { data, error } = await client.rpc("bms_is_super_admin");

    if (error) {
      console.warn("Admin check:", error.message);
      isSuperAdmin = false;
      return false;
    }

    isSuperAdmin = data === true;
    $("adminPanel").classList.toggle("hidden", !isSuperAdmin);
    return isSuperAdmin;
  }

  function displayBusiness() {
    $("welcomeTitle").textContent =
      currentBusiness?.business_name || "ব্যবসার ড্যাশবোর্ড";

    $("subscriptionStatus").textContent = "যাচাই প্রয়োজন";
    $("expiryDate").textContent = "—";
  }

  async function loadSubscription() {
    if (!currentBusiness?.id) return;

    const { data, error } = await client
      .from("bms_subscriptions")
      .select("*")
      .eq("business_id", currentBusiness.id)
      .order("expires_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("Subscription:", error.message);
      $("subscriptionStatus").textContent = "যাচাই প্রয়োজন";
      return;
    }

    const subscription = data?.[0];

    if (!subscription) {
      $("subscriptionStatus").textContent = "পেমেন্ট প্রয়োজন";
      return;
    }

    const expiry = subscription.expires_at
      ? new Date(subscription.expires_at)
      : null;

    if (expiry && !Number.isNaN(expiry.getTime())) {
      $("expiryDate").textContent = expiry.toLocaleDateString("bn-BD");
    }

    if (subscription.status === "active" && expiry && expiry >= new Date()) {
      $("subscriptionStatus").textContent = "চালু";
    } else {
      $("subscriptionStatus").textContent = "মেয়াদ/অনুমোদন যাচাই করুন";
    }
  }

  async function openApp(user) {
    currentUser = user;
    clearMessage();

    try {
      const business = await findBusiness();

      if (!business) {
        showAuthenticatedScreen();
        $("welcomeTitle").textContent = "অ্যাকাউন্ট যাচাই হচ্ছে";
        $("subscriptionStatus").textContent = "প্রোফাইল পাওয়া যায়নি";
        $("expiryDate").textContent = "—";

        showMessage(
          "লগইন হয়েছে, কিন্তু আপনার ব্যবসার প্রোফাইল পাওয়া যায়নি। " +
          "Supabase-এর bms_businesses টেবিল ও signup SQL যাচাই করতে হবে।",
          true
        );
        return;
      }

      showAuthenticatedScreen();
      displayBusiness();

      await loadSubscription();
      await checkAdmin();

      if (isSuperAdmin) {
        await loadAdminPayments();
      }
    } catch (error) {
      showMessage("অ্যাকাউন্টের তথ্য লোড হয়নি: " + readableError(error), true);
    }
  }

  $("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    setBusy(form, true);

    try {
      const businessName = $("businessName").value.trim();
      const ownerName = $("ownerName").value.trim();
      const phone = $("signupPhone").value.trim();
      const email = $("signupEmail").value.trim();
      const password = $("signupPassword").value;

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            business_name: businessName,
            owner_name: ownerName,
            phone
          }
        }
      });

      if (error) throw error;

      if (data.session && data.user) {
        const { error: insertError } = await client
          .from("bms_businesses")
          .insert({
            owner_id: data.user.id,
            business_name: businessName,
            owner_name: ownerName,
            phone
          });

        if (insertError) {
          throw new Error(
            "অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু ব্যবসার তথ্য সংরক্ষণ হয়নি: " +
            insertError.message
          );
        }

        await openApp(data.user);
        showMessage("অ্যাকাউন্ট তৈরি হয়েছে। পেমেন্ট অনুমোদনের জন্য জমা দিন।");
      } else {
        showMessage(
          "রেজিস্ট্রেশন অনুরোধ সফল। ইমেইলে নিশ্চিতকরণ লিংক এলে সেটি সম্পন্ন করে লগইন করুন।"
        );
        showLoginTab("login");
      }
    } catch (error) {
      showMessage(readableError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    setBusy(form, true);

    try {
      const email = $("loginEmail").value.trim();
      const password = $("loginPassword").value;

      const { data, error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await openApp(data.user);
      showMessage("লগইন সফল হয়েছে।");
    } catch (error) {
      showMessage("লগইন হয়নি: " + readableError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  $("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const form = event.currentTarget;
    setBusy(form, true);

    try {
      if (!currentUser || !currentBusiness?.id) {
        throw new Error("আপনার ব্যবসার অ্যাকাউন্ট পাওয়া যায়নি। আবার লগইন করুন।");
      }

      const paymentMethod = $("paymentMethod").value;
      const senderPhone = $("paymentPhone").value.trim();
      const transactionId = $("transactionId").value.trim();

      if (!paymentMethod || !senderPhone || !transactionId) {
        throw new Error("সব পেমেন্ট তথ্য পূরণ করুন।");
      }

      const { error } = await client
        .from("bms_payments")
        .insert({
          business_id: currentBusiness.id,
          user_id: currentUser.id,
          amount: 500,
          payment_method: paymentMethod,
          sender_phone: senderPhone,
          transaction_id: transactionId,
          status: "pending"
        });

      if (error) throw error;

      form.reset();
      showMessage(
        "পেমেন্টের তথ্য জমা হয়েছে। Super Admin যাচাই করে অনুমোদন দিলে সাবস্ক্রিপশন চালু হবে।"
      );

      if (isSuperAdmin) await loadAdminPayments();
    } catch (error) {
      showMessage("পেমেন্ট জমা হয়নি: " + readableError(error), true);
    } finally {
      setBusy(form, false);
    }
  });

  async function loadAdminPayments() {
    const container = $("adminContent");
    container.textContent = "পেমেন্টের তথ্য লোড হচ্ছে...";

    try {
      if (!isSuperAdmin) {
        throw new Error("এই অংশ শুধু Super Admin ব্যবহার করতে পারবেন।");
      }

      const { data, error } = await client
        .from("bms_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      container.replaceChildren();

      if (!data?.length) {
        container.textContent = "এখনো কোনো পেমেন্ট আবেদন নেই।";
        return;
      }

      data.forEach((payment) => {
        const item = document.createElement("article");
        item.className = "admin-item";

        const details = document.createElement("p");
        details.textContent =
          "ব্যবসার ID: " + (payment.business_id || "—") +
          " | পরিমাণ: ৳" + (payment.amount ?? "—") +
          " | মাধ্যম: " + (payment.payment_method || "—") +
          " | নম্বর: " + (payment.sender_phone || "—") +
          " | Transaction ID: " + (payment.transaction_id || "—") +
          " | অবস্থা: " + (payment.status || "—");

        item.appendChild(details);

        const status = String(payment.status || "").toLowerCase();

        if (status === "pending") {
          const approve = document.createElement("button");
          approve.className = "primary";
          approve.textContent = "অনুমোদন করুন";
          approve.addEventListener("click", () =>
            reviewPayment(payment.id, true, approve)
          );

          const reject = document.createElement("button");
          reject.className = "secondary";
          reject.textContent = "বাতিল করুন";
          reject.addEventListener("click", () =>
            reviewPayment(payment.id, false, reject)
          );

          item.append(approve, reject);
        }

        container.appendChild(item);
      });
    } catch (error) {
      container.textContent = "অ্যাডমিন তথ্য লোড হয়নি: " + readableError(error);
    }
  }

  async function reviewPayment(paymentId, approve, button) {
    if (!isSuperAdmin) {
      showMessage("আপনার এই কাজের অনুমতি নেই।", true);
      return;
    }

    button.disabled = true;

    try {
      const functionName = approve
        ? "bms_approve_payment"
        : "bms_reject_payment";

      const { error } = await client.rpc(functionName, {
        p_payment_id: paymentId
      });

      if (error) throw error;

      showMessage(
        approve
          ? "পেমেন্ট অনুমোদনের অনুরোধ সফল হয়েছে।"
          : "পেমেন্ট বাতিলের অনুরোধ সফল হয়েছে।"
      );

      await loadAdminPayments();
      await loadSubscription();
    } catch (error) {
      showMessage(
        "পেমেন্ট পর্যালোচনা হয়নি। RPC নাম, প্যারামিটার ও RLS নীতি যাচাই করুন: " +
        readableError(error),
        true
      );
      button.disabled = false;
    }
  }

  $("refreshAdmin").addEventListener("click", async () => {
    await loadAdminPayments();
  });

  $("logoutBtn").addEventListener("click", async () => {
    const { error } = await client.auth.signOut();

    if (error) {
      showMessage("লগআউট হয়নি: " + readableError(error), true);
      return;
    }

    showUnauthenticatedScreen();
    showLoginTab("login");
    showMessage("লগআউট সফল হয়েছে।");
  });

  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      showUnauthenticatedScreen();
    }
  });

  async function initialize() {
    try {
      if (
        !SUPABASE_URL ||
        !SUPABASE_ANON_KEY ||
        SUPABASE_ANON_KEY.includes("PASTE_YOUR_")
      ) {
        showMessage("config.js-এ Supabase Publishable/anon key বসান।", true);
        return;
      }

      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      if (data.session?.user) {
        await openApp(data.session.user);
      }
    } catch (error) {
      showMessage("অ্যাপ চালু হয়নি: " + readableError(error), true);
    }
  }

  initialize();
})();
