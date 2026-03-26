import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let blockedFile = path.join(__dirname, "blocked_proxies.txt")

async function readBlocked(file = path.join(__dirname, "blocked_proxies.txt")) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return txt
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const [host, port, user, pass] = line.split(":");
        return { host, port, user, pass };
      });
  } catch {
    return [];
  }
}

export async function readProxies(file = path.join(__dirname, "proxies.txt")) {
  const txt = await fs.readFile(file, "utf8");
  const blocked = await readBlocked();

  const allProxies = txt
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [host, port, user, pass] = line.split(":");
      return { host, port, user, pass };
    });

  // 🧠 Filter out any proxy that’s in blocked_proxies.txt
  const usableProxies = allProxies.filter(
    p =>
      !blocked.some(
        b =>
          b.host === p.host &&
          String(b.port) === String(p.port) &&
          (b.user || "") === (p.user || "") &&
          (b.pass || "") === (p.pass || "")
      )
  );

  console.log(
    `📊 Loaded ${allProxies.length} proxies, skipped ${blocked.length} blocked → usable: ${usableProxies.length}`
  );

  return usableProxies;
}




export async function fetchPrice(url) {
  const proxies = await readProxies();
  console.log("total proxies", proxies.length)
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
//   console.log(proxy)
//    proxy.port ="10190"
  console.log(`🛜 Using proxy ${proxy.host}:${proxy.port}`);



  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      `--proxy-server=http://${proxy.host}:${proxy.port}`,
    ],
  });

  const page = await browser.newPage();

  try {

    await page.authenticate({ username: proxy.user, password: proxy.pass });


    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });


    const bodyText = await page.evaluate(() => document.body.innerText.trim() )


//console.log("📄 Body preview:", bodyText.slice(0, 100));


    if(bodyText == '{"message":"Forbidden"}'){
       console.warn(`🚫 Proxy ${proxy.host}:${proxy.port} is blocked or requires auth`);

        // ✅ Compare all key fields (host, port, user, pass)
        const remaining = proxies.filter(
            p =>
            !(
                p.host === proxy.host &&
                String(p.port) === String(proxy.port) &&
                (p.user || "") === (proxy.user || "") &&
                (p.pass || "") === (proxy.pass || "")
            )
        );

        await fs.writeFile("./proxies.json", JSON.stringify(remaining, null, 2));
        console.log(`🧹 Removed exact proxy: ${proxy.host}:${proxy.port} (${proxy.user})`);


        const blockedLine = `${proxy.host}:${proxy.port}:${proxy.user || ""}:${proxy.pass || ""}\n`;
        await fs.appendFile(blockedFile, blockedLine);

        throw new Error("Bad proxy (forbidden or 407)");

    }

    // wait until the price container actually renders
    await page.waitForSelector(".price-unit .w-price", {
      timeout: 15000,
    });

    // extract price text
    const price_each = await page.$eval(
      ".price-unit .w-price",
      el => el.textContent.trim()
    );


    const finalUrl = page.url();

    const target = new URL(url);
    const current = new URL(finalUrl);

    // Ignore protocol (http vs https), trailing slashes, and query strings
    const sameHost = target.hostname.replace(/^www\./, "") === current.hostname.replace(/^www\./, "");
    const samePath = target.pathname.replace(/\/+$/, "") === current.pathname.replace(/\/+$/, "");

    let is_backordered = false;
    let backorderText = "";

    // Try to find the element
    const backorderElement = await page.$(".backorder-text");
    
    if (backorderElement) {
        // Get text
        backorderText = await page.$eval(
            ".backorder-text",
            el => el.textContent.trim()
        );

        // Check text for "backorder"
        if (backorderText.toLowerCase().includes("backorder")) {
            is_backordered = true;
        }
    }



    if (sameHost && samePath) {
        console.log("syncing backordered status as well")
        return {price_each, is_backordered};
    }


    
    console.log("url mismatches")
    throw new Error("URL mimatches")


  } catch (err) {
    console.error("❌ Error fetching price:", err.message);
    throw err
  } finally {
    await browser.close();
  }
}

