const form =
    document.getElementById("companyForm");

const input =
    document.getElementById("companyInput");

const result =
    document.getElementById("result");

const companyName =
    document.getElementById("companyName");

const checkedDate =
    document.getElementById("checkedDate");

const statusBadge =
    document.getElementById("statusBadge");

const passedCount =
    document.getElementById("passedCount");

const failedCount =
    document.getElementById("failedCount");

const notVerifiedCount =
    document.getElementById("notVerifiedCount");

const assessmentTitle =
    document.getElementById("assessmentTitle");

const assessmentMessage =
    document.getElementById("assessmentMessage");

const checksContainer =
    document.getElementById("checksContainer");


/*
==========================================================
ANIMATION VARIABLES
==========================================================
*/

let analysisTimer = null;

let progressTimer = null;


/*
==========================================================
FORM SUBMISSION
==========================================================
*/

form.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();


        const company =
            input.value.trim();


        if (!company) {

            input.focus();

            return;

        }


        /*
        Show result section.
        */

        result.classList.remove("hidden");


        /*
        Scroll to report.
        */

        setTimeout(() => {

            result.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        }, 100);


        /*
        Start loading screen.
        */

        setLoadingState(company);


        /*
        Record when request started.
        */

        const startTime =
            Date.now();


        try {

            const response =
                await fetch(
                    "/api/check-company",
                    {

                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                company: company
                            })

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Unable to analyze this company."
                );

            }


            /*
            ------------------------------------------------
            IMPORTANT

            Keep the animation visible for at least
            2.5 seconds so the user can actually see it.
            ------------------------------------------------
            */

            const elapsed =
                Date.now() - startTime;


            const minimumTime =
                2500;


            const remaining =
                Math.max(
                    0,
                    minimumTime - elapsed
                );


            setTimeout(() => {

                displayReport(data);

            }, remaining);

        }


        catch (error) {

            displayError(
                error.message
            );

        }

    }
);


/*
==========================================================
LOADING SCREEN
==========================================================
*/

function setLoadingState(company) {

    /*
    Company information.
    */

    companyName.textContent =
        company;


    checkedDate.textContent =
        "Running verification checks...";


    /*
    Assessment.
    */

    assessmentTitle.textContent =
        "Analyzing company...";


    assessmentMessage.textContent =
        "We're checking publicly available technical information. Please wait while we investigate the domain.";


    /*
    Status.
    */

    statusBadge.textContent =
        "ANALYZING";


    statusBadge.className =
        "status analyzing";


    /*
    Reset counters.
    */

    passedCount.textContent =
        "—";

    failedCount.textContent =
        "—";

    notVerifiedCount.textContent =
        "—";


    /*
    ------------------------------------------------------
    ANALYSIS UI
    ------------------------------------------------------
    */

    checksContainer.innerHTML = `

        <div class="analysis-box">

            <div class="analysis-animation">

                <div class="scanner">

                    <div class="scanner-ring ring-one"></div>

                    <div class="scanner-ring ring-two"></div>

                    <div class="scanner-line"></div>

                    <div class="scanner-dot"></div>

                </div>

            </div>


            <div class="analysis-content">

                <div class="analysis-eyebrow">
                    LIVE VERIFICATION
                </div>


                <strong id="analysisTitle">
                    Starting verification...
                </strong>


                <p id="analysisMessage">
                    Preparing security checks.
                </p>


                <div class="analysis-progress">

                    <div
                        id="analysisProgressBar"
                        class="analysis-progress-bar">
                    </div>

                </div>


                <div
                    id="analysisPercentage"
                    class="analysis-percentage">
                    0%
                </div>

            </div>

        </div>

    `;


    startAnalysisAnimation();

}


/*
==========================================================
ANALYSIS ANIMATION
==========================================================
*/

function startAnalysisAnimation() {

    stopAnalysisAnimation();


    const title =
        document.getElementById(
            "analysisTitle"
        );


    const message =
        document.getElementById(
            "analysisMessage"
        );


    const progressBar =
        document.getElementById(
            "analysisProgressBar"
        );


    const percentage =
        document.getElementById(
            "analysisPercentage"
        );


    if (
        !title ||
        !message ||
        !progressBar
    ) {

        return;

    }


    /*
    ------------------------------------------------------
    VERIFICATION STEPS
    ------------------------------------------------------
    */

    const steps = [

        {
            title:
                "Checking domain",

            message:
                "Resolving the company domain through DNS."
        },

        {
            title:
                "Checking website",

            message:
                "Testing whether the website responds."
        },

        {
            title:
                "Checking HTTPS",

            message:
                "Verifying the website's secure connection."
        },

        {
            title:
                "Checking registration",

            message:
                "Looking for public domain registration information."
        },

        {
            title:
                "Reviewing evidence",

            message:
                "Combining the available verification results."
        }

    ];


    let currentStep =
        0;


    let progress =
        4;


    /*
    Show first step immediately.
    */

    title.textContent =
        steps[0].title;


    message.textContent =
        steps[0].message;


    /*
    ------------------------------------------------------
    CHANGE STEP
    ------------------------------------------------------
    */

    analysisTimer =
        setInterval(() => {

            currentStep++;


            if (
                currentStep >=
                steps.length
            ) {

                currentStep =
                    steps.length - 1;

            }


            title.textContent =
                steps[currentStep].title;


            message.textContent =
                steps[currentStep].message;


        }, 500);


    /*
    ------------------------------------------------------
    PROGRESS
    ------------------------------------------------------

    This is intentionally slow.

    It never reaches 100% while waiting.
    */

    progressTimer =
        setInterval(() => {

            if (progress < 90) {

                progress +=
                    Math.random() * 3 + 1;


                progress =
                    Math.min(
                        progress,
                        90
                    );


                progressBar.style.width =
                    `${progress}%`;


                if (percentage) {

                    percentage.textContent =
                        `${Math.round(progress)}%`;

                }

            }

        }, 150);

}


/*
==========================================================
STOP ANIMATION
==========================================================
*/

function stopAnalysisAnimation() {

    if (analysisTimer) {

        clearInterval(
            analysisTimer
        );

        analysisTimer =
            null;

    }


    if (progressTimer) {

        clearInterval(
            progressTimer
        );

        progressTimer =
            null;

    }

}


/*
==========================================================
DISPLAY REPORT
==========================================================
*/

function displayReport(data) {

    stopAnalysisAnimation();


    /*
    Complete progress animation.
    */

    const progressBar =
        document.getElementById(
            "analysisProgressBar"
        );


    if (progressBar) {

        progressBar.style.width =
            "100%";

    }


    /*
    Company.
    */

    companyName.textContent =
        data.company;


    /*
    Date.
    */

    const date =
        new Date(
            data.checkedAt
        );


    checkedDate.textContent =
        "Report generated: " +
        date.toLocaleString();


    /*
    Summary.
    */

    passedCount.textContent =
        data.summary.passed;


    failedCount.textContent =
        data.summary.failed;


    notVerifiedCount.textContent =
        data.summary.notVerified;


    /*
    Assessment.
    */

    assessmentTitle.textContent =
        data.assessment.title;


    assessmentMessage.textContent =
        data.assessment.message;


    /*
    Status.
    */

    statusBadge.textContent =
        getAssessmentLabel(
            data.assessment.level
        );


    statusBadge.className =
        "status " +
        getAssessmentClass(
            data.assessment.level
        );


    /*
    Checks.
    */

    checksContainer.innerHTML =
        "";


    if (
        !Array.isArray(data.checks) ||
        data.checks.length === 0
    ) {

        checksContainer.innerHTML = `

            <div class="check-card">

                <strong>
                    No verification checks available
                </strong>

                <p class="check-explanation">
                    The system could not produce any checks for this input.
                </p>

            </div>

        `;

        return;

    }


    /*
    Create check cards.
    */

    data.checks.forEach(
        (check, index) => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "check-card result-card";


            card.style.animationDelay =
                `${index * 100}ms`;


            const statusInfo =
                getStatusInfo(
                    check.status
                );


            card.innerHTML = `

                <div class="check-top">

                    <div>

                        <div class="check-category">
                            ${escapeHTML(
                                check.category
                            )}
                        </div>


                        <div class="check-name">
                            ${escapeHTML(
                                check.name
                            )}
                        </div>

                    </div>


                    <div
                        class="check-status ${statusInfo.className}">

                        ${statusInfo.label}

                    </div>

                </div>


                <p class="check-explanation">

                    ${escapeHTML(
                        check.explanation
                    )}

                </p>


                <div class="check-source">

                    <strong>
                        Source:
                    </strong>

                    ${escapeHTML(
                        check.source
                    )}

                </div>

            `;


            checksContainer.appendChild(
                card
            );

        }
    );

}


/*
==========================================================
ERROR
==========================================================
*/

function displayError(message) {

    stopAnalysisAnimation();


    statusBadge.textContent =
        "ERROR";


    statusBadge.className =
        "status high";


    checkedDate.textContent =
        "The report could not be generated.";


    passedCount.textContent =
        "—";


    failedCount.textContent =
        "—";


    notVerifiedCount.textContent =
        "—";


    assessmentTitle.textContent =
        "Something went wrong";


    assessmentMessage.textContent =
        message ||
        "The server could not complete the verification.";


    checksContainer.innerHTML = `

        <div class="check-card error-card">

            <div class="check-top">

                <div>

                    <div class="check-category">
                        SYSTEM
                    </div>

                    <div class="check-name">
                        Verification failed
                    </div>

                </div>


                <div class="check-status fail">
                    ERROR
                </div>

            </div>


            <p class="check-explanation">

                ${escapeHTML(
                    message ||
                    "Unable to complete the verification."
                )}

            </p>

        </div>

    `;

}


/*
==========================================================
STATUS
==========================================================
*/

function getStatusInfo(status) {

    if (
        status ===
        "PASS"
    ) {

        return {
            label: "PASS",
            className: "pass"
        };

    }


    if (
        status ===
        "FAIL"
    ) {

        return {
            label: "FAIL",
            className: "fail"
        };

    }


    return {
        label: "NOT VERIFIED",
        className: "not-verified"
    };

}


/*
==========================================================
ASSESSMENT
==========================================================
*/

function getAssessmentLabel(level) {

    if (
        level ===
        "LOW_CONCERN"
    ) {

        return "LOW CONCERN";

    }


    if (
        level ===
        "CAUTION"
    ) {

        return "CAUTION";

    }


    if (
        level ===
        "HIGH_CONCERN"
    ) {

        return "HIGH CONCERN";

    }


    return "REVIEW";

}


function getAssessmentClass(level) {

    if (
        level ===
        "LOW_CONCERN"
    ) {

        return "low";

    }


    if (
        level ===
        "CAUTION"
    ) {

        return "caution";

    }


    if (
        level ===
        "HIGH_CONCERN"
    ) {

        return "high";

    }


    return "";

}


/*
==========================================================
SECURITY
==========================================================
*/

function escapeHTML(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}