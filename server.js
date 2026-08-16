const express = require("express");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));


/*
==========================================================
INPUT / DOMAIN HELPERS
==========================================================
*/


function extractDomain(input) {

    let value = input.trim();

    /*
        If the user enters:

        microsoft.com
        https://microsoft.com
        http://www.microsoft.com/jobs

        convert everything into a URL.
    */

    if (!/^https?:\/\//i.test(value)) {
        value = "https://" + value;
    }


    let url;

    try {

        url = new URL(value);

    } catch {

        return null;

    }


    /*
        Only allow HTTP/HTTPS.

        This prevents weird protocols from being
        passed into our checker.
    */

    if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
    ) {

        return null;

    }


    let hostname =
        url.hostname.toLowerCase();


    /*
        Remove www.

        Example:

        www.microsoft.com

        becomes:

        microsoft.com
    */

    if (hostname.startsWith("www.")) {

        hostname =
            hostname.substring(4);

    }


    /*
        Basic domain validation.
    */

    if (
        !hostname ||
        !hostname.includes(".") ||
        hostname.length > 253
    ) {

        return null;

    }


    return {
        domain: hostname,
        originalUrl: url
    };

}


/*
==========================================================
PRIVATE IP PROTECTION
==========================================================

Our server will make requests to websites supplied by users.

We don't want users to make our server request:

localhost
127.0.0.1
private network addresses
etc.

This basic protection helps prevent SSRF-style abuse.
*/


function isPrivateIP(address) {

    if (net.isIPv4(address)) {

        const parts =
            address.split(".").map(Number);


        const a = parts[0];
        const b = parts[1];


        if (a === 10) {
            return true;
        }


        if (
            a === 172 &&
            b >= 16 &&
            b <= 31
        ) {

            return true;

        }


        if (a === 192 && b === 168) {
            return true;
        }


        if (a === 127) {
            return true;
        }


        if (a === 169 && b === 254) {
            return true;
        }

    }


    if (net.isIPv6(address)) {

        const normalized =
            address.toLowerCase();


        if (
            normalized === "::1" ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            normalized.startsWith("fe80:")
        ) {

            return true;

        }

    }


    return false;

}


/*
==========================================================
DNS CHECK
==========================================================
*/


async function checkDNS(domain) {

    try {

        const records =
            await dns.lookup(
                domain,
                {
                    all: true
                }
            );


        if (!records.length) {

            return {
                status: "FAIL",
                explanation:
                    "The domain did not resolve to an IP address.",
                source:
                    "DNS lookup"
            };

        }


        const addresses =
            records.map(
                record => record.address
            );


        const privateAddress =
            addresses.some(
                address =>
                    isPrivateIP(address)
            );


        if (privateAddress) {

            return {
                status: "FAIL",
                explanation:
                    "The domain resolved to a private or local network address and was not checked further.",
                source:
                    "DNS lookup"
            };

        }


        return {
            status: "PASS",
            explanation:
                `The domain resolved successfully to ${addresses.length} IP address${addresses.length === 1 ? "" : "es"}.`,
            source:
                "DNS lookup"
        };

    }

    catch (error) {

        return {
            status: "FAIL",
            explanation:
                "The domain could not be resolved through DNS.",
            source:
                "DNS lookup"
        };

    }

}


/*
==========================================================
WEBSITE / HTTPS CHECK
==========================================================
*/


async function checkWebsite(domain) {

    const urls = [
        `https://${domain}`,
        `http://${domain}`
    ];


    let httpsResult = null;
    let httpResult = null;


    /*
        Try HTTPS first.
    */

    try {

        const response =
            await fetch(
                urls[0],
                {
                    method: "GET",
                    redirect: "follow",
                    signal:
                        AbortSignal.timeout(8000)
                }
            );


        httpsResult = {

            success: true,

            statusCode:
                response.status,

            finalUrl:
                response.url

        };

    }

    catch (error) {

        httpsResult = {

            success: false,

            error:
                error.message

        };

    }


    /*
        If HTTPS didn't work, try HTTP.

        This allows us to distinguish:

        HTTPS works
        HTTPS doesn't work but HTTP works
        Website doesn't respond
    */

    if (!httpsResult.success) {

        try {

            const response =
                await fetch(
                    urls[1],
                    {
                        method: "GET",
                        redirect: "follow",
                        signal:
                            AbortSignal.timeout(8000)
                    }
                );


            httpResult = {

                success: true,

                statusCode:
                    response.status,

                finalUrl:
                    response.url

            };

        }

        catch (error) {

            httpResult = {

                success: false,

                error:
                    error.message

            };

        }

    }


    /*
        HTTPS SUCCESS
    */

    if (httpsResult.success) {

        return {

            website: {
                status: "PASS",
                explanation:
                    `The website responded successfully over HTTPS with HTTP status ${httpsResult.statusCode}.`,
                source:
                    `HTTPS request to ${httpsResult.finalUrl}`
            },

            https: {
                status: "PASS",
                explanation:
                    "The submitted domain successfully established an HTTPS connection.",
                source:
                    `HTTPS request to ${httpsResult.finalUrl}`
            }

        };

    }


    /*
        HTTP works but HTTPS doesn't.
    */

    if (
        httpResult &&
        httpResult.success
    ) {

        return {

            website: {
                status: "PASS",
                explanation:
                    `The website responded over HTTP with status ${httpResult.statusCode}.`,
                source:
                    `HTTP request to ${httpResult.finalUrl}`
            },

            https: {
                status: "FAIL",
                explanation:
                    "The website responded over HTTP, but an HTTPS connection could not be established.",
                source:
                    `HTTPS request to https://${domain}`
            }

        };

    }


    /*
        Nothing worked.
    */

    return {

        website: {
            status: "FAIL",
            explanation:
                "The website did not respond successfully over HTTP or HTTPS.",
            source:
                `HTTP/HTTPS requests to ${domain}`
        },

        https: {
            status: "FAIL",
            explanation:
                "An HTTPS connection could not be established.",
            source:
                `HTTPS request to https://${domain}`
        }

    };

}


/*
==========================================================
LINK EXTRACTION HELPER
==========================================================

Extract useful links from the homepage.

We only keep HTTP/HTTPS links belonging to the
same website.
*/

function extractLinks(html, baseURL) {

    const links = [];

    const linkPattern =
        /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

    let match;

    while (
        (match = linkPattern.exec(html)) !== null
    ) {

        const href =
            match[1].trim();


        if (!href) {
            continue;
        }


        /*
            Ignore things such as:

            #
            javascript:
            mailto:
            tel:
        */

        if (
            href.startsWith("#") ||
            href.toLowerCase().startsWith("javascript:") ||
            href.toLowerCase().startsWith("mailto:") ||
            href.toLowerCase().startsWith("tel:")
        ) {

            continue;

        }


        try {

            const absoluteURL =
                new URL(
                    href,
                    baseURL
                );


            if (
                absoluteURL.protocol !== "http:" &&
                absoluteURL.protocol !== "https:"
            ) {

                continue;

            }


            /*
                Only follow links on the same hostname.

                This prevents us from accidentally crawling
                external websites.
            */

            const base =
                new URL(baseURL);


            if (
                absoluteURL.hostname !==
                base.hostname
            ) {

                continue;

            }


            links.push(
                absoluteURL.href
            );

        }

        catch {

            /*
                Ignore malformed URLs.
            */

        }

    }


    /*
        Remove duplicates.
    */

    return [
        ...new Set(links)
    ];

}


/*
==========================================================
WEBSITE CONTENT CHECK
==========================================================

Inspect the company's homepage for basic public
company information and important legal pages.
*/

/*
==========================================================
WEBSITE CONTENT CHECK
==========================================================

Inspect the homepage and relevant internal pages for:

- Email
- Phone
- Contact page
- About page
- Privacy Policy
- Terms & Conditions

The checker does not treat missing information as
proof of fraud.
*/

async function checkWebsiteContent(domain) {

    const homepageURL =
        `https://${domain}`;


    try {

        /*
        ==================================================
        FETCH HOMEPAGE
        ==================================================
        */

        const homepageResponse =
            await fetch(
                homepageURL,
                {
                    method: "GET",
                    redirect: "follow",
                    signal:
                        AbortSignal.timeout(10000)
                }
            );


        if (!homepageResponse.ok) {

            return {

                status:
                    "NOT_VERIFIED",

                explanation:
                    `The homepage returned HTTP status ${homepageResponse.status}.`,

                source:
                    homepageResponse.url ||
                    homepageURL

            };

        }


        const contentType =
            homepageResponse.headers
                .get("content-type") || "";


        if (
            !contentType.includes(
                "text/html"
            )
        ) {

            return {

                status:
                    "NOT_VERIFIED",

                explanation:
                    "The website did not return an HTML page that could be inspected.",

                source:
                    homepageResponse.url ||
                    homepageURL

            };

        }


        const homepageHTML =
            await homepageResponse.text();


        /*
        ==================================================
        COLLECT PAGES TO CHECK
        ==================================================
        */

        const homepageURLFinal =
            homepageResponse.url ||
            homepageURL;


        const links =
            extractLinks(
                homepageHTML,
                homepageURLFinal
            );


        /*
            We will inspect:

            Homepage
            + up to 5 relevant internal pages.

            This prevents the checker from crawling
            an entire website.
        */

        const pages = [

            {
                url:
                    homepageURLFinal,

                type:
                    "Homepage"
            }

        ];


        /*
        ==================================================
        FIND RELEVANT LINKS
        ==================================================
        */

        const pagePatterns = {

            contact:
                /contact|get-in-touch|reach-us/i,

            about:
                /about|company|who-we-are/i,

            privacy:
                /privacy|privacy-policy/i,

            terms:
                /terms|terms-of-service|terms-and-conditions/i

        };


        const selectedTypes =
            new Set();


        for (
            const link
            of links
        ) {

            let pathname = "";


            try {

                pathname =
                    new URL(link)
                        .pathname
                        .toLowerCase();

            }

            catch {

                continue;

            }


            for (
                const [type, pattern]
                of Object.entries(
                    pagePatterns
                )
            ) {

                if (
                    !selectedTypes.has(type) &&
                    pattern.test(pathname)
                ) {

                    pages.push({

                        url:
                            link,

                        type:
                            type

                    });


                    selectedTypes.add(type);

                    break;

                }

            }


            /*
                Maximum:

                Homepage
                Contact
                About
                Privacy
                Terms

                = 5 pages
            */

            if (
                pages.length >= 5
            ) {

                break;

            }

        }


        /*
        ==================================================
        FETCH SELECTED PAGES
        ==================================================
        */

        const pageResults = [];


        for (
            const page
            of pages
        ) {

            try {

                const response =
                    page.type === "Homepage"
                        ? homepageResponse
                        : await fetch(
                            page.url,
                            {
                                method:
                                    "GET",

                                redirect:
                                    "follow",

                                signal:
                                    AbortSignal.timeout(
                                        8000
                                    )
                            }
                        );


                if (
                    !response.ok
                ) {

                    continue;

                }


                const type =
                    response.headers
                        .get(
                            "content-type"
                        ) || "";


                if (
                    !type.includes(
                        "text/html"
                    )
                ) {

                    continue;

                }


                const html =
                    page.type === "Homepage"
                        ? homepageHTML
                        : await response.text();


                pageResults.push({

                    type:
                        page.type,

                    url:
                        response.url ||
                        page.url,

                    html:
                        html

                });

            }

            catch {

                /*
                    One failed page should not cause
                    the entire company check to fail.
                */

            }

        }


        /*
        ==================================================
        SEARCH ALL CHECKED PAGES
        ==================================================
        */

        let emailFound =
            false;

        let emailSource =
            null;


        let phoneFound =
            false;

        let phoneSource =
            null;


        /*
        ==================================================
        EMAIL
        ==================================================
        */

        const emailPattern =
            /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;


        const mailtoPattern =
            /href\s*=\s*["']mailto:([^"']+)["']/i;


        /*
        ==================================================
        PHONE
        ==================================================
        */

        const telPattern =
            /href\s*=\s*["']tel:\s*[\d\s().+\-]{7,}["']/i;


        for (
            const page
            of pageResults
        ) {

            /*
            ----------------------------------------------
            EMAIL
            ----------------------------------------------
            */

            if (
                !emailFound &&
                emailPattern.test(
                    page.html
                )
            ) {

                emailFound =
                    true;

                emailSource =
                    page.url;

            }


            if (
                !emailFound &&
                mailtoPattern.test(
                    page.html
                )
            ) {

                emailFound =
                    true;

                emailSource =
                    page.url;

            }


            /*
            ----------------------------------------------
            PHONE
            ----------------------------------------------
            */

            if (
                !phoneFound &&
                telPattern.test(
                    page.html
                )
            ) {

                phoneFound =
                    true;

                phoneSource =
                    page.url;

            }

        }


        /*
        ==================================================
        PAGE EXISTENCE
        ==================================================
        */

        const contactPage =
            pageResults.find(
                page =>
                    page.type ===
                    "contact"
            );


        const aboutPage =
            pageResults.find(
                page =>
                    page.type ===
                    "about"
            );


        const privacyPage =
            pageResults.find(
                page =>
                    page.type ===
                    "privacy"
            );


        const termsPage =
            pageResults.find(
                page =>
                    page.type ===
                    "terms"
            );


        /*
        ==================================================
        FINAL RESULT
        ==================================================
        */

        return {

            status:
                "PASS",

            explanation:
                `The homepage and ${pageResults.length - 1} relevant internal page${pageResults.length - 1 === 1 ? "" : "s"} were inspected.`,

            source:
                homepageURLFinal,

            details: {

                emailFound,

                emailSource,

                phoneFound,

                phoneSource,

                contactFound:
                    Boolean(contactPage),

                contactSource:
                    contactPage
                        ? contactPage.url
                        : null,

                aboutFound:
                    Boolean(aboutPage),

                aboutSource:
                    aboutPage
                        ? aboutPage.url
                        : null,

                privacyFound:
                    Boolean(privacyPage),

                privacySource:
                    privacyPage
                        ? privacyPage.url
                        : null,

                termsFound:
                    Boolean(termsPage),

                termsSource:
                    termsPage
                        ? termsPage.url
                        : null

            }

        };

    }

    catch (error) {

        return {

            status:
                "NOT_VERIFIED",

            explanation:
                "The website could not be inspected for public company information.",

            source:
                homepageURL

        };

    }

}



/*
==========================================================
WEBSITE PURPOSE CHECK
==========================================================

Determine the likely primary purpose of the website
using publicly available page content.

This is an evidence-based classification.
It is NOT a guarantee about the company.
*/

async function checkWebsitePurpose(domain) {

    const homepageURL =
        `https://${domain}`;

    try {

        const response =
            await fetch(
                homepageURL,
                {
                    method: "GET",
                    redirect: "follow",
                    signal:
                        AbortSignal.timeout(10000)
                }
            );


        if (!response.ok) {

            return {

                status: "NOT_VERIFIED",

                title: "Website purpose could not be determined",

                description:
                    "The homepage could not be inspected successfully.",

                source:
                    response.url ||
                    homepageURL

            };

        }


        const contentType =
            response.headers
                .get("content-type") || "";


        if (
            !contentType.includes("text/html")
        ) {

            return {

                status: "NOT_VERIFIED",

                title: "Website purpose could not be determined",

                description:
                    "The website did not return an HTML page that could be analyzed.",

                source:
                    response.url ||
                    homepageURL

            };

        }


        const html =
            await response.text();


        /*
            Remove HTML tags and convert the page
            into readable text.
        */

        const text =
            html
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .toLowerCase();


        /*
        ======================================================
        PURPOSE KEYWORDS
        ======================================================
        */

        const purposes = [

            {
                title:
                    "Business / Company Website",

                description:
                    "The website appears to primarily represent a business or company and provide information about its products, services, or organization.",

                keywords: [
                    "about us",
                    "our company",
                    "our services",
                    "our products",
                    "solutions",
                    "business",
                    "company"
                ]
            },


            {
                title:
                    "E-commerce / Online Store",

                description:
                    "The website appears to primarily be used for selling products or services online.",

                keywords: [
                    "add to cart",
                    "shopping cart",
                    "buy now",
                    "checkout",
                    "shop now",
                    "products",
                    "order now",
                    "price"
                ]
            },


            {
                title:
                    "Job / Recruitment Website",

                description:
                    "The website appears to primarily provide employment, recruitment, or job-related information.",

                keywords: [
                    "careers",
                    "career",
                    "jobs",
                    "job openings",
                    "vacancies",
                    "hiring",
                    "join our team",
                    "employment",
                    "recruitment"
                ]
            },


            {
                title:
                    "Educational / Learning Website",

                description:
                    "The website appears to primarily provide educational, training, or learning-related content.",

                keywords: [
                    "courses",
                    "course",
                    "learn",
                    "learning",
                    "education",
                    "training",
                    "students",
                    "academy",
                    "classes"
                ]
            },


            {
                title:
                    "Technology / Software Website",

                description:
                    "The website appears to primarily provide software, technology, or technology-related services.",

                keywords: [
                    "software",
                    "platform",
                    "technology",
                    "api",
                    "developer",
                    "cloud",
                    "saas",
                    "app"
                ]
            },


            {
                title:
                    "Information / Content Website",

                description:
                    "The website appears to primarily provide informational, news, media, or educational content.",

                keywords: [
                    "news",
                    "articles",
                    "blog",
                    "information",
                    "guides",
                    "resources",
                    "stories"
                ]
            }

        ];


        /*
        ======================================================
        SCORE EACH PURPOSE
        ======================================================
        */

        let bestPurpose = null;

        let bestScore = 0;


        for (
            const purpose
            of purposes
        ) {

            let score = 0;


            for (
                const keyword
                of purpose.keywords
            ) {

                if (
                    text.includes(
                        keyword
                    )
                ) {

                    score++;

                }

            }


            if (
                score > bestScore
            ) {

                bestScore =
                    score;

                bestPurpose =
                    purpose;

            }

        }


        /*
        ======================================================
        RESULT
        ======================================================
        */

        if (
            !bestPurpose ||
            bestScore === 0
        ) {

            return {

                status:
                    "NOT_VERIFIED",

                title:
                    "Website purpose could not be determined",

                description:
                    "The available website content did not provide enough clear information to confidently determine its primary purpose.",

                source:
                    response.url ||
                    homepageURL

            };

        }


        return {

            status:
                "PASS",

            title:
                bestPurpose.title,

            description:
                bestPurpose.description,

            source:
                response.url ||
                homepageURL

        };

    }

    catch (error) {

        return {

            status:
                "NOT_VERIFIED",

            title:
                "Website purpose could not be determined",

            description:
                "The website could not be inspected for enough public information to determine its primary purpose.",

            source:
                homepageURL

        };

    }

}

/*
==========================================================
RDAP DOMAIN CHECK
==========================================================

RDAP is the modern structured replacement for WHOIS.

We use RDAP.org as the first prototype endpoint.

Later we can implement direct IANA bootstrap
resolution for greater control and scalability.
*/




async function checkRDAP(domain) {

    const rdapURL =
        `https://rdap.org/domain/${encodeURIComponent(domain)}`;


    try {

        const response =
            await fetch(
                rdapURL,
                {
                    redirect: "follow",
                    signal:
                        AbortSignal.timeout(10000)
                }
            );


        if (!response.ok) {

            if (response.status === 404) {

                return {

                    status: "FAIL",

                    explanation:
                        "No RDAP registration record was returned for this domain.",

                    source:
                        rdapURL

                };

            }


            return {

                status: "NOT_VERIFIED",

                explanation:
                    `The RDAP service could not provide a definitive result (HTTP ${response.status}).`,

                source:
                    rdapURL

            };

        }


        const data =
            await response.json();


        /*
            Extract useful registration information.
        */

        let registrar =
            null;

        let creationDate =
            null;

        let expirationDate =
            null;


        /*
            Events
        */

        if (Array.isArray(data.events)) {

            for (
                const event
                of data.events
            ) {

                if (
                    event.eventAction ===
                    "registration"
                ) {

                    creationDate =
                        event.eventDate;

                }


                if (
                    event.eventAction ===
                    "expiration"
                ) {

                    expirationDate =
                        event.eventDate;

                }

            }

        }


        /*
            Registrar

            RDAP entity data varies between registrars,
            so we look carefully instead of assuming
            one exact structure.
        */

        if (Array.isArray(data.entities)) {

            const registrarEntity =
                data.entities.find(
                    entity =>
                        Array.isArray(
                            entity.roles
                        ) &&
                        entity.roles.includes(
                            "registrar"
                        )
                );


            if (
                registrarEntity &&
                Array.isArray(
                    registrarEntity.vcardArray
                )
            ) {

                const vcard =
                    registrarEntity.vcardArray[1];


                if (Array.isArray(vcard)) {

                    const fn =
                        vcard.find(
                            item =>
                                Array.isArray(item) &&
                                item[0] === "fn"
                        );


                    if (fn) {

                        registrar =
                            fn[3];

                    }

                }

            }

        }


        return {

            status: "PASS",

            explanation:
                "A public RDAP registration record was found for this domain.",

            source:
                rdapURL,

            details: {

                registrar:
                    registrar || "Not disclosed",

                creationDate:
                    creationDate || "Not disclosed",

                expirationDate:
                    expirationDate || "Not disclosed"

            }

        };

    }

    catch (error) {

        return {

            status: "NOT_VERIFIED",

            explanation:
                "The domain could not be independently verified through RDAP at this time.",

            source:
                rdapURL

        };

    }

}



/*
==========================================================
WEBSITE PURPOSE CHECK
==========================================================

Determines what the website appears to be primarily used for.

This is an evidence-based classification.

It does NOT claim that a company is legitimate or fraudulent.
==========================================================
*/

async function checkWebsitePurpose(domain) {

    const homepageURL = `https://${domain}`;

    try {

        const response = await fetch(
            homepageURL,
            {
                method: "GET",
                redirect: "follow",
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!response.ok) {

            return {
                status: "NOT_VERIFIED",
                purpose: "Unknown",
                confidence: "Low",
                description:
                    "The website could not be inspected well enough to determine its primary purpose.",
                source: homepageURL
            };

        }

        const contentType =
            response.headers.get("content-type") || "";

        if (!contentType.includes("text/html")) {

            return {
                status: "NOT_VERIFIED",
                purpose: "Unknown",
                confidence: "Low",
                description:
                    "The website did not provide an HTML page that could be analyzed.",
                source: homepageURL
            };

        }

        const html = await response.text();


        /*
        ======================================================
        EXTRACT WEBSITE INFORMATION
        ======================================================
        */

        const titleMatch =
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

        const descriptionMatch =
            html.match(
                /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
            );


        const headings = [];

        const headingPattern =
            /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

        let headingMatch;

        while (
            (headingMatch =
                headingPattern.exec(html)) !== null
        ) {

            headings.push(
                headingMatch[1]
            );

        }


        /*
        ======================================================
        REMOVE HTML
        ======================================================
        */

        const visibleText =
            html
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    " "
                )
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    " "
                )
                .replace(
                    /<noscript[\s\S]*?<\/noscript>/gi,
                    " "
                )
                .replace(
                    /<[^>]+>/g,
                    " "
                )
                .replace(
                    /&nbsp;/gi,
                    " "
                )
                .replace(
                    /&amp;/gi,
                    "&"
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        const title =
            titleMatch
                ? titleMatch[1]
                : "";

        const description =
            descriptionMatch
                ? descriptionMatch[1]
                : "";


        /*
        ======================================================
        COMBINED PUBLIC INFORMATION
        ======================================================
        */

        const evidenceText = (
            title +
            " " +
            description +
            " " +
            headings.join(" ") +
            " " +
            visibleText
        ).toLowerCase();


        /*
        ======================================================
        PURPOSE CATEGORIES
        ======================================================

        We score categories instead of simply looking
        for one keyword.

        This makes the classification more reliable.
        ======================================================
        */

        const categories = {

            adult: {

                purpose:
                    "Adult content / entertainment",

                description:
                    "The website appears primarily focused on adult-oriented content or entertainment.",

                keywords: [

                    "porn",
                    "pornography",
                    "xxx",
                    "adult video",
                    "adult videos",
                    "adult content",
                    "sex video",
                    "sex videos",
                    "nude",
                    "nudity",
                    "18+",
                    "nsfw",
                    "onlyfans",
                    "erotic",
                    "cam girl",
                    "camgirl",
                    "escort"

                ]

            },


            jobs: {

                purpose:
                    "Jobs / recruitment",

                description:
                    "The website appears primarily focused on jobs, recruitment, hiring, or employment opportunities.",

                keywords: [

                    "jobs",
                    "job openings",
                    "job opening",
                    "careers",
                    "career",
                    "vacancies",
                    "vacancy",
                    "hiring",
                    "recruitment",
                    "recruiting",
                    "employment",
                    "apply now",
                    "job seekers",
                    "work with us"

                ]

            },


            ecommerce: {

                purpose:
                    "E-commerce / shopping",

                description:
                    "The website appears primarily focused on selling products or services online.",

                keywords: [

                    "shop",
                    "shopping",
                    "buy now",
                    "add to cart",
                    "cart",
                    "checkout",
                    "products",
                    "product",
                    "store",
                    "orders",
                    "shipping",
                    "delivery"

                ]

            },


            news: {

                purpose:
                    "News / media",

                description:
                    "The website appears primarily focused on publishing news, articles, reports, or media content.",

                keywords: [

                    "news",
                    "breaking news",
                    "latest news",
                    "headlines",
                    "articles",
                    "journal",
                    "report",
                    "reports",
                    "press",
                    "media"

                ]

            },


            education: {

                purpose:
                    "Education / learning",

                description:
                    "The website appears primarily focused on education, courses, training, or learning resources.",

                keywords: [

                    "courses",
                    "course",
                    "education",
                    "learning",
                    "students",
                    "student",
                    "training",
                    "lessons",
                    "tutorials",
                    "school",
                    "university",
                    "academy"

                ]

            },


            technology: {

                purpose:
                    "Technology / software",

                description:
                    "The website appears primarily focused on technology, software, digital products, or technical services.",

                keywords: [

                    "software",
                    "technology",
                    "technology solutions",
                    "app",
                    "application",
                    "developer",
                    "developers",
                    "cloud",
                    "api",
                    "artificial intelligence",
                    "ai",
                    "cybersecurity",
                    "digital solutions"

                ]

            },


            finance: {

                purpose:
                    "Finance / financial services",

                description:
                    "The website appears primarily focused on financial services, payments, investing, or related financial information.",

                keywords: [

                    "banking",
                    "bank",
                    "loan",
                    "loans",
                    "investment",
                    "investments",
                    "trading",
                    "insurance",
                    "finance",
                    "financial services",
                    "payment",
                    "payments",
                    "credit"

                ]

            },


            entertainment: {

                purpose:
                    "Entertainment / media",

                description:
                    "The website appears primarily focused on entertainment, videos, music, movies, or related media.",

                keywords: [

                    "movies",
                    "movie",
                    "music",
                    "songs",
                    "videos",
                    "video",
                    "entertainment",
                    "celebrity",
                    "streaming",
                    "shows",
                    "tv"

                ]

            },


            social: {

                purpose:
                    "Social / community",

                description:
                    "The website appears primarily focused on social interaction, community participation, or user-generated content.",

                keywords: [

                    "community",
                    "forum",
                    "forums",
                    "members",
                    "follow",
                    "followers",
                    "profile",
                    "profiles",
                    "social network",
                    "discussion"

                ]

            },


            business: {

                purpose:
                    "Business / company website",

                description:
                    "The website appears primarily focused on presenting a company, its services, products, or business information.",

                keywords: [

                    "about us",
                    "our company",
                    "our services",
                    "our products",
                    "business",
                    "company",
                    "corporate",
                    "solutions",
                    "services",
                    "contact us",
                    "clients",
                    "customers"

                ]

            }

        };


        /*
        ======================================================
        SCORE EACH CATEGORY
        ======================================================
        */

        const scores = [];


        for (
            const [key, category]
            of Object.entries(categories)
        ) {

            let score = 0;

            const matchedKeywords = [];


            for (
                const keyword
                of category.keywords
            ) {

                if (
                    evidenceText.includes(
                        keyword.toLowerCase()
                    )
                ) {

                    score++;

                    matchedKeywords.push(
                        keyword
                    );

                }

            }


            scores.push({

                key,

                score,

                matchedKeywords

            });

        }


        /*
        ======================================================
        SORT BY SCORE
        ======================================================
        */

        scores.sort(
            (a, b) =>
                b.score - a.score
        );


        const best =
            scores[0];


        /*
        ======================================================
        NOT ENOUGH EVIDENCE
        ======================================================
        */

        if (
            !best ||
            best.score === 0
        ) {

            return {

                status:
                    "NOT_VERIFIED",

                purpose:
                    "Unable to determine",

                confidence:
                    "Low",

                description:
                    "The available homepage information was not sufficient to reliably determine what the website is primarily used for.",

                source:
                    homepageURL

            };

        }


        /*
        ======================================================
        CONFIDENCE
        ======================================================
        */

        let confidence = "Medium";


        if (
            best.score >= 4
        ) {

            confidence = "High";

        }


        /*
        ======================================================
        BUILD EVIDENCE DESCRIPTION
        ======================================================
        */

        const evidence =
            best.matchedKeywords
                .slice(0, 5)
                .join(", ");


        return {

            status:
                "PASS",

            purpose:
                categories[best.key].purpose,

            confidence:
                confidence,

            description:
                categories[best.key].description,

            evidence:
                evidence,

            source:
                homepageURL

        };

    }

    catch (error) {

        return {

            status:
                "NOT_VERIFIED",

            purpose:
                "Unable to determine",

            confidence:
                "Low",

            description:
                "The website could not be inspected reliably enough to determine its primary purpose.",

            source:
                homepageURL

        };

    }

}

/*
==========================================================
MAIN COMPANY CHECK
==========================================================
*/


app.post(
    "/api/check-company",
    async (req, res) => {

        const {
            company
        } = req.body;


        if (
            !company ||
            company.trim() === ""
        ) {

            return res.status(400).json({

                error:
                    "Please enter a company name or website."

            });

        }


        const input =
            company.trim();


        /*
            Try to interpret the input as a domain.

            Example:

            microsoft.com
            https://microsoft.com

            will work.

            A plain company name like:

            Microsoft

            will not yet have enough information
            for domain verification.
        */

        const parsed =
            extractDomain(input);


        /*
        ======================================================
        COMPANY NAME ONLY
        ======================================================
        */

        if (!parsed) {

            const checks = [

                {
                    id: "website",

                    category: "Website",

                    name:
                        "Website exists",

                    status:
                        "NOT_VERIFIED",

                    explanation:
                        "A website/domain was not provided, so the website could not be independently checked.",

                    source:
                        "User input"
                },

                {
                    id: "https",

                    category: "Website",

                    name:
                        "HTTPS enabled",

                    status:
                        "NOT_VERIFIED",

                    explanation:
                        "An HTTPS check requires a valid website domain.",

                    source:
                        "User input"
                },

                {
                    id: "domain_registration",

                    category: "Domain",

                    name:
                        "Domain registration",

                    status:
                        "NOT_VERIFIED",

                    explanation:
                        "A domain was not provided, so domain registration could not be checked.",

                    source:
                        "User input"
                }

            ];


            const passed =
                checks.filter(
                    check =>
                        check.status ===
                        "PASS"
                ).length;


            const failed =
                checks.filter(
                    check =>
                        check.status ===
                        "FAIL"
                ).length;


            const notVerified =
                checks.filter(
                    check =>
                        check.status ===
                        "NOT_VERIFIED"
                ).length;


            return res.json({

                company: input,

                checkedAt:
                    new Date().toISOString(),

                summary: {

                    total:
                        checks.length,

                    passed,

                    failed,

                    notVerified

                },

                checks,

                assessment: {

                    level:
                        "CAUTION",

                    title:
                        "A website is needed for deeper verification",

                    message:
                        "Enter the company's website/domain so Company Checker can perform real technical and registration checks."

                }

            });

        }


        const domain =
            parsed.domain;


        /*
        ======================================================
        RUN REAL CHECKS
        ======================================================
        */

        const dnsResult =
            await checkDNS(domain);


        /*
            If DNS fails, there is no point trying to
            aggressively contact the website.
        */

        let websiteResult = {

            website: {

                status:
                    "NOT_VERIFIED",

                explanation:
                    "Website reachability was not checked because the domain did not resolve successfully.",

                source:
                    "DNS result"

            },

            https: {

                status:
                    "NOT_VERIFIED",

                explanation:
                    "HTTPS was not checked because the domain did not resolve successfully.",

                source:
                    "DNS result"

            }

        };


        if (
            dnsResult.status ===
            "PASS"
        ) {

            websiteResult =
                await checkWebsite(
                    domain
                );

        }


        const rdapResult =
            await checkRDAP(domain);
        
        
        const contentResult =
            await checkWebsiteContent(domain);

        const purposeResult =
            await checkWebsitePurpose(domain);


        /*
        ======================================================
        BUILD TRANSPARENT CHECK LIST
        ======================================================
        */

        const checks = [

            {

                id:
                    "domain",

                category:
                    "Domain",

                name:
                    "Domain resolves",

                status:
                    dnsResult.status,

                explanation:
                    dnsResult.explanation,

                source:
                    dnsResult.source

            },


            {

                id:
                    "website",

                category:
                    "Website",

                name:
                    "Website exists",

                status:
                    websiteResult.website.status,

                explanation:
                    websiteResult.website.explanation,

                source:
                    websiteResult.website.source

            },


            {

                id:
                    "https",

                category:
                    "Website",

                name:
                    "HTTPS enabled",

                status:
                    websiteResult.https.status,

                explanation:
                    websiteResult.https.explanation,

                source:
                    websiteResult.https.source

            },


            {

                id:
                    "registration",

                category:
                    "Domain",

                name:
                    "Domain registration",

                status:
                    rdapResult.status,

                explanation:
                    rdapResult.explanation,

                source:
                    rdapResult.source

            },

        {
    id:
        "website_purpose",

    category:
        "Website Analysis",

    name:
        "Website purpose",

    status:
        purposeResult.status,

    explanation:
        purposeResult.description,

    source:
        purposeResult.source,

    purposeTitle:
        purposeResult.title

},

        ];


        /*
            Add registration details if available.
        */

        if (
            rdapResult.details
        ) {

            checks.push({

                id:
                    "registrar",

                category:
                    "Domain",

                name:
                    "Registrar",

                status:
                    rdapResult.details.registrar !==
                    "Not disclosed"
                        ? "PASS"
                        : "NOT_VERIFIED",

                explanation:
                    rdapResult.details.registrar !==
                    "Not disclosed"
                        ? `Registrar identified as ${rdapResult.details.registrar}.`
                        : "The registrar was not disclosed in the available RDAP response.",

                source:
                    rdapResult.source

            });


            checks.push({

                id:
                    "domain_creation",

                category:
                    "Domain",

                name:
                    "Domain creation date",

                status:
                    rdapResult.details.creationDate !==
                    "Not disclosed"
                        ? "PASS"
                        : "NOT_VERIFIED",

                explanation:
                    rdapResult.details.creationDate !==
                    "Not disclosed"
                        ? `Registration date: ${rdapResult.details.creationDate}.`
                        : "The domain creation date was not disclosed in the available RDAP response.",

                source:
                    rdapResult.source

            });


            checks.push({

                id:
                    "domain_expiration",

                category:
                    "Domain",

                name:
                    "Domain expiration date",

                status:
                    rdapResult.details.expirationDate !==
                    "Not disclosed"
                        ? "PASS"
                        : "NOT_VERIFIED",

                explanation:
                    rdapResult.details.expirationDate !==
                    "Not disclosed"
                        ? `Expiration date: ${rdapResult.details.expirationDate}.`
                        : "The domain expiration date was not disclosed in the available RDAP response.",

                source:
                    rdapResult.source

            });

        }


        /*
==========================================================
WEBSITE CONTENT CHECKS
==========================================================
*/

if (
    contentResult.status === "PASS" &&
    contentResult.details
) {

    checks.push({

        id:
            "email",

        category:
            "Company Information",

        name:
            "Email address",

        status:
            contentResult.details.emailFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.emailFound
                ? "A public email address was found on the website."
                : "No public email address was detected on the homepage.",

        source:
            contentResult.source

    });


    checks.push({

        id:
            "phone",

        category:
            "Company Information",

        name:
            "Phone number",

        status:
            contentResult.details.phoneFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.phoneFound
                ? "A possible phone number was found on the website."
                : "No phone number was detected on the homepage.",

        source:
            contentResult.source

    });


    checks.push({

        id:
            "contact",

        category:
            "Company Information",

        name:
            "Contact page",

        status:
            contentResult.details.contactFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.contactFound
                ? "A contact page or contact information was detected."
                : "A dedicated contact page was not detected.",

        source:
            contentResult.source

    });


    checks.push({

        id:
            "about",

        category:
            "Company Information",

        name:
            "About page",

        status:
            contentResult.details.aboutFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.aboutFound
                ? "An About page or company information section was detected."
                : "An About page was not detected.",

        source:
            contentResult.source

    });


    checks.push({

        id:
            "privacy",

        category:
            "Legal",

        name:
            "Privacy Policy",

        status:
            contentResult.details.privacyFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.privacyFound
                ? "A Privacy Policy was detected."
                : "A Privacy Policy was not detected.",

        source:
            contentResult.source

    });


    checks.push({

        id:
            "terms",

        category:
            "Legal",

        name:
            "Terms & Conditions",

        status:
            contentResult.details.termsFound
                ? "PASS"
                : "NOT_VERIFIED",

        explanation:
            contentResult.details.termsFound
                ? "Terms or Terms & Conditions were detected."
                : "Terms & Conditions were not detected.",

        source:
            contentResult.source

    });

}

        /*
        ======================================================
        SUMMARY
        ======================================================
        */

        const passed =
            checks.filter(
                check =>
                    check.status ===
                    "PASS"
            ).length;


        const failed =
            checks.filter(
                check =>
                    check.status ===
                    "FAIL"
            ).length;


        const notVerified =
            checks.filter(
                check =>
                    check.status ===
                    "NOT_VERIFIED"
            ).length;


        /*
        ======================================================
        ASSESSMENT
        ======================================================

        IMPORTANT:

        We do NOT say:

        "This company is safe."

        We only describe the evidence.
        */

        let assessment;


        if (
            failed >= 2
        ) {

            assessment = {

                level:
                    "HIGH_CONCERN",

                title:
                    "Multiple technical warning signs found",

                message:
                    "Several technical checks failed. Review the evidence carefully before trusting this website or company."

            };

        }

        else if (
            failed === 1
        ) {

            assessment = {

                level:
                    "CAUTION",

                title:
                    "A warning sign was found",

                message:
                    "At least one verification check failed. This does not prove fraud, but the result deserves further investigation."

            };

        }

        else if (
            notVerified > passed
        ) {

            assessment = {

                level:
                    "CAUTION",

                title:
                    "More information is needed",

                message:
                    "The available public data is not sufficient for a strong assessment. Continue verifying the company independently."

            };

        }

        else {

            assessment = {

                level:
                    "LOW_CONCERN",

                title:
                    "No major technical warning signs found",

                message:
                    "The checks performed so far did not identify major technical warning signs. This is not a guarantee that the company, website, or job offer is legitimate."

            };

        }


        /*
        ======================================================
        FINAL RESPONSE
        ======================================================
        */
        res.json({

    
    company: 
        input, 

    domain: 
        domain, 

    checkedAt: 
        new Date().toISOString(),

    websitePurpose:
        purposeResult,

    summary: {

        total:
            checks.length,

        passed,

        failed,

        notVerified

    },

    checks,

    websitePurpose: {

        status:
            purposeResult.status,

        title:
            purposeResult.title,

        description:
            purposeResult.description,

        source:
            purposeResult.source

    },

    assessment

});

    }
);


/*
==========================================================
SERVER
==========================================================
*/


app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "======================================"
        );

        console.log(
            "      COMPANY CHECKER IS RUNNING"
        );

        console.log(
            "======================================"
        );

        console.log("");

        console.log(
            `Open: http://localhost:${PORT}`
        );

        console.log("");

    }
);