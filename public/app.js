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

const analysisAnimation =
    document.getElementById("analysisAnimation");

const websitePurpose =
    document.getElementById("websitePurpose");

const purposeTitle =
    document.getElementById("purposeTitle");

const purposeDescription =
    document.getElementById("purposeDescription");

const purposeSource =
    document.getElementById("purposeSource");


/* =========================================================
   ANALYSIS STATE
========================================================= */

let analysisTimer = null;

let currentStep = 1;


/*
    Start visual analysis animation.
*/

function startAnalysisAnimation() {

    currentStep = 1;

    analysisAnimation.classList.remove("hidden");

    checksContainer.classList.add("hidden");

    const steps =
        document.querySelectorAll(
            ".analysis-step"
        );


    steps.forEach(step => {

        step.classList.remove(
            "active",
            "completed"
        );

    });


    if (steps.length > 0) {

        steps[0].classList.add(
            "active"
        );

    }


    /*
        Move through the visual steps.

        IMPORTANT:

        These are visual only.

        The real verification is still
        performed by server.js.
    */

    analysisTimer =
        setInterval(() => {

            const current =
                document.querySelector(
                    `.analysis-step[data-step="${currentStep}"]`
                );


            if (current) {

                current.classList.remove(
                    "active"
                );

                current.classList.add(
                    "completed"
                );

            }


            currentStep++;


            if (currentStep <= 6) {

                const next =
                    document.querySelector(
                        `.analysis-step[data-step="${currentStep}"]`
                    );


                if (next) {

                    next.classList.add(
                        "active"
                    );

                }

            }

            else {

                stopAnalysisAnimation();

            }

        }, 1000);

}


/*
    Stop visual animation.
*/

function stopAnalysisAnimation() {

    if (analysisTimer) {

        clearInterval(
            analysisTimer
        );

        analysisTimer = null;

    }

}


/*
    Hide scanner and show actual results.
*/

function finishAnalysisAnimation() {

    stopAnalysisAnimation();

    analysisAnimation.classList.add(
        "hidden"
    );

    checksContainer.classList.remove(
        "hidden"
    );

}


/* =========================================================
   FORM
========================================================= */

form.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();


        const company =
            input.value.trim();


        if (!company) {

            alert(
                "Please enter a company name or website."
            );

            return;

        }


        /*
            Show result area.
        */

        result.classList.remove(
            "hidden"
        );


        companyName.textContent =
            company;


        statusBadge.textContent =
            "ANALYZING...";


        statusBadge.className =
            "status";


        passedCount.textContent =
            "0";


        failedCount.textContent =
            "0";


        notVerifiedCount.textContent =
            "0";


        assessmentTitle.textContent =
            "Analyzing company...";


        assessmentMessage.textContent =
            "Company Checker is checking publicly available information.";


        /*
            Start visual scanner.
        */

        startAnalysisAnimation();


        try {

            /*
                THIS IS YOUR EXISTING
                BACKEND CONNECTION.

                DO NOT CHANGE IT.
            */

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
                                company:
                                    company
                            })

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Unable to analyze company."
                );

            }


            /*
                Real backend result received.
            */

            finishAnalysisAnimation();


            displayReport(
                data
            );

        }

        catch (error) {

            finishAnalysisAnimation();


            statusBadge.textContent =
                "ERROR";


            statusBadge.className =
                "status high";


            assessmentTitle.textContent =
                "Something went wrong";


            assessmentMessage.textContent =
                error.message;


            checksContainer.innerHTML =
                "";

        }

    }
);


/* =========================================================
   DISPLAY REPORT
========================================================= */

function displayReport(data) {

/* =========================================================
   WEBSITE PURPOSE
========================================================= */

function displayWebsitePurpose(data) {

    const purpose = data.websitePurpose;

    /*
        No purpose result at all
    */

    if (!purpose) {

        websitePurpose.classList.add(
            "hidden"
        );

        return;

    }


    /*
        Website purpose could not be determined.
    */

    if (
        purpose.status === "NOT_VERIFIED" ||
        !purpose.purpose ||
        purpose.purpose === "Unable to determine"
    ) {

        websitePurpose.classList.remove(
            "hidden"
        );


        purposeTitle.textContent =
            "Unable to determine";


        purposeDescription.textContent =
            purpose.description ||
            "There was not enough reliable public information to determine what this website is primarily used for.";


        purposeSource.textContent =
            purpose.source ||
            "Website homepage";


        return;

    }


    /*
        A purpose was successfully detected.
    */

    websitePurpose.classList.remove(
        "hidden"
    );


    purposeTitle.textContent =
        purpose.purpose;


    let description =
        purpose.description ||
        "The website appears to be primarily used for this type of activity.";


    if (
        purpose.confidence
    ) {

        description +=
            ` Confidence: ${purpose.confidence}.`;

    }


    purposeDescription.textContent =
        description;


    let sourceText =
        purpose.source ||
        "Website homepage";


    if (
        purpose.evidence
    ) {

        sourceText +=
            ` | Detected signals: ${purpose.evidence}`;

    }


    purposeSource.textContent =
        sourceText;

}


    const date =
        new Date(
            data.checkedAt
        );


    checkedDate.textContent =
        "Report generated: " +
        date.toLocaleString();


    passedCount.textContent =
        data.summary.passed;


    failedCount.textContent =
        data.summary.failed;


    notVerifiedCount.textContent =
        data.summary.notVerified;


    assessmentTitle.textContent =
        data.assessment.title;


    assessmentMessage.textContent =
        data.assessment.message;


    statusBadge.textContent =
        getAssessmentLabel(
            data.assessment.level
        );


    statusBadge.className =
        "status " +
        getAssessmentClass(
            data.assessment.level
        );


    checksContainer.innerHTML =
        "";


    data.checks.forEach(
        (check, index) => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "check-card";


            /*
                Small delay gives the result
                cards a nice sequential appearance.
            */

            card.style.animationDelay =
                `${index * 70}ms`;


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
                        class="check-status ${statusInfo.className}"
                    >

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


/* =========================================================
   WEBSITE PURPOSE
========================================================= */

function displayWebsitePurpose(data) {

    if (
        !data.websitePurpose
    ) {

        websitePurpose.classList.add(
            "hidden"
        );

        return;

    }


    const purpose =
        data.websitePurpose;


    websitePurpose.classList.remove(
        "hidden"
    );


    purposeTitle.textContent =
        purpose.purpose ||
        "Unable to determine";


    let description =
        purpose.description ||
        "The available public information was not sufficient to determine the website's primary purpose.";


    if (
        purpose.confidence
    ) {

        description +=
            ` Confidence: ${purpose.confidence}.`;

    }


    purposeDescription.textContent =
        description;


    let sourceText =
        purpose.source ||
        "Website homepage";


    if (
        purpose.evidence
    ) {

        sourceText +=
            ` | Detected signals: ${purpose.evidence}`;

    }


    purposeSource.textContent =
        sourceText;

}

/* =========================================================
   STATUS
========================================================= */

function getStatusInfo(status) {

    if (status === "PASS") {

        return {

            label:
                "PASS",

            className:
                "pass"

        };

    }


    if (status === "FAIL") {

        return {

            label:
                "FAIL",

            className:
                "fail"

        };

    }


    return {

        label:
            "NOT VERIFIED",

        className:
            "not-verified"

    };

}


/* =========================================================
   ASSESSMENT
========================================================= */

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


    return "HIGH CONCERN";

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


    return "high";

}


/* =========================================================
   HTML SECURITY
========================================================= */

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