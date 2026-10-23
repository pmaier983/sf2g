# Prerequisites

## Environment

This document assumes you’re familiar with technologies such as Node.js (Javascript/TypeScript), command shell, etc.

You need to have the latest versions of these tools installed in your environment:

* Node.js ([https://nodejs.org/en](https://nodejs.org/en))
* Yarn ([https://yarnpkg.com/getting-started/install](https://yarnpkg.com/getting-started/install))

## GitHub Repos

### Strava Scraper

[https://github.com/j-c-w/strava](https://github.com/j-c-w/strava)

Private repo containing the Strava scraping scripts, maintained by Jackson Woodruff ([woodruffjackson@gmail.com](mailto:woodruffjackson@gmail.com)), a cyclist in Edinburgh, Scotland. This repo is a fork of [https://github.com/jimmynicol/strava](https://github.com/jimmynicol/strava) originally written by former AV member James Nicol.

The scripts are written in Typescript and executed by Node.js.

### Route Viewer

[https://github.com/j-c-w/route-viewer](https://github.com/j-c-w/route-viewer)

Public repo containing the route viewer webapp, which displays “Egan routes” (e.g. Strava routes with highlighted segments) and optionally, segment leaderboard results for a specific ride. Like the scraper repo, this repo is maintained by Jackson Woodruff and is a fork of [https://github.com/jimmynicol/route-viewer](https://github.com/jimmynicol/route-viewer), originally written by James Nicol.

The route viewer app is written in TypeScript/React.js using the Next.js web application framework, and is hosted by Vercel, a cloud platform provider.

The original route viewer, used by Egan rides, still works as designed and can be found running at this URL (with a sample result named “test-feb-2025”): [https://route-viewer.vercel.app/results/test-feb-2025](https://route-viewer.vercel.app/results/test-feb-2025)

The forked route viewer used by Jackson Woodruff for his rides in Edinburgh has been modified to show a different logo and other slight differences. It can be found running at this URL (with the “latest” results): [https://edinburgh-hillz.vercel.app/results/latest](https://edinburgh-hillz.vercel.app/results/latest).

## Strava Account and API Settings

You must be on a paid Strava account. The scraper will not work if you have a free Strava plan.

You must setup an API Application in your Strava settings: [https://www.strava.com/settings/api](https://www.strava.com/settings/api)

Keep note of the following pieces of information on this page:

* Client ID (5-digit number identifying your account)
* Client Secret (confidential string used for authentication)
* Access Token (short-lived key for authentication & authorization, refreshed every 6 hours)

## Strava Scraper Configuration

Before running the scraper, you need to configure your environment. This information is also in the README.md file.

(1) Create a .stravarc file in your home directory containing your Strava account info in JSON format:

{
    "email": "\[MY STRAVA LOGIN EMAIL\]",
    "password": "\[MY STRAVA PASSWORD\]",
    "client\_secret": "\[MY STRAVA CLIENT SECRET (Settings/API)\]
}

(2) Run yarn install
(3) Run yarn dev (or yarn build)
(4) Use the exported bin command strava to access the services

If \#4 works for you, you can run the basic scraping script with the \--help argument to confirm it’s installed correctly:
strava \--help
strava ride-efforts \--help

If for some reason, the exported bin command doesn’t work for you (it doesn’t work for me), then you can run the above commands like this:
node dist/index.js \--help
node dist/index.js ride-efforts \--help

(2) Modify src/services/api-access-token.ts to comment out the oauth POST call. Note that this is where Jackson Woodruff and I are seeing different behavior. For him, this code works, but for me it throws an HTTP 400 bad request error.

The function retrieveAPIAccessToken() should be modified as follows:
​​export async function retrieveAPIAccessToken(p: Page): Promise\<string\> {
  console.log("Open ");
  console.log(getStravaAuthUrl());
  function getCode(): Promise\<string\> {
    const rl \= readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) \=\> {
      rl.question("Please enter your access token: ", (input) \=\> {
        console.log("User input:", input);
        rl.close();
        resolve(input);
      });
    });

    // axios.post commented out...
  }

  return await getCode();
}

After modifying this file run yarn build to compile the changes.

(3) Modify src/services/web-session.ts to change the puppeteer configuration. Puppeteer is a third-party scraping library that can control either a headless or real browser. In order for the Strava scraper to work with Strava’s login page (which uses a captcha), the browser cannot be run in headless mode.

The function createWebSession() should be modified to point to where Google Chrome is located in your environment. Running on a Mac, this is how I modified it for my use:
export async function createWebSession(verbose \= false): Promise\<Page\> {
  if (verbose) logger("creating page object");

  // create puppeteer object
  const browser \= await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:false,
    args: \[
    '--user-data-dir="/Users/akindirik/Library/Application Support/Google/Chrome/Profile 6"'
    \]
  });

  ...
}

After modifying this file run yarn build to compile the changes.

(4) Modify src/services/segment-efforts.ts to comment out the call to filterSegmentEffortsByClubMember() in the call to pageOfEfforts(). Without this change, the results are limited only to Egan club members, but I find this to be too restrictive for a couple of reasons. The first is that sometimes the script fails to scrape all the members of the Egan Strava club, and secondly with Egan gaining popularity, many riders don’t bother to join the Egan Strava club.

After modifying this file run yarn build to compile the changes.

# Running the scraper to generate results

(1) Identify info about the route:

* Strava route ID (it has to be a public route)
* Strava segment IDs
* Strava club ID (the Egan club is 469663\)
* Date on which the ride occurred
* Title of the ride (keep this short and simple since it gets appended to the route viewer URL, as well as unique so it doesn’t clash with other ride results)

(2) Run the scraper with the correct arguments:

* \-v: verbose flag should be on since it’s useful for debugging
* –url: Route viewer URL for the ride-r: Strava route ID
* \-s: Strava segment IDs, separated by commas (no spaces)
* \-c: Strava club ID, or “egan” for the Egan club
* \-s: Strava segment IDs, separated by commas (no spaces)
* \-d: date of the ride, YYYY-DD-MM format
* \-t: title of the ride
* \--outputFile: ride results in JSON format
* \--includeAllTime true
* \--includeNonMembers true

node dist/index.js ride-efforts \-v –url ‘https://route-viewer.vercel.app/route?r=3347750304333512530\&s=913443,631065,15025857,21192549,2190242,2903975,7994833,640149,6664213,711223,617901’-r 3327146786727723592 \-c egan469663 \-s 1631602,7563239 \-d 2025-02-18 \-t "Not-ready-for-Egan" \--outputFile test-2025-02-18.json

(3) The script will launch Chrome. If the Strava login page is displayed, login with your credentials. On subsequent runs your login info might be cached.

(4) The script will prompt you for the access token. You need to grab this from [https://www.strava.com/settings/api](https://www.strava.com/settings/api) where it says "Your Access Token". The token is valid for 6 hours

(5) You’ll need to be patient while the scraping is done. The first time the script is run, it will scrape the Egan club member page to retrieve all the club members. This info is cached so it won’t do this the next time the script is run.

(6) If the script fails, you can try running it again (sometimes the errors are transient). However, if the error is persistent, you’ll need to troubleshoot it (this is where your technical expertise comes in).

(7) Note that if you run the script too much on a given day, you might hit Strava API limits.

(8) If the script has completed successfully it should generate a valid JSON file containing the ride results.

# Filter results

The scraped results will include everyone who uploaded a public Strava activity on that day including at least one segment. That may include athletes who had no intention of riding Egan, especially if the route covers multiple popular segments. A second script can post-process the results to exclude activities with under a specified number of completed segments. This does not need to scrape results again. To run this pick a threshold expressed as a proportion of all segments and run the script with the following arguments:

* \-i: Input file name
* \-o: Output file name
* \-t: Threshold between 0.0 (nothing filtered out) and 1.0 (all segments must be completed to show up)
* \-v: Verbose, optional

For example:

node dist/index.js filter-results \-i egan-2025-08-all.json \-o egan-2025-08.json \-t 0.5 \-v

If the verbose flag is provided then the script will output links to the strava activities for all athletes who were filtered out along with the number of segments they completed.

# Uploading ride results

In order for the route viewer to display the ride results, they must be uploaded to a specific AWS S3 bucket. The route viewer repo has a script, upload-results.js, which does this.

Before running this script, create or modify .env.local to specify variables needed for AWS:
ACCESS\_KEY\_ID\_AWS=YOUR_AWS_ACCESS_KEY_ID
SECRET\_ACCESS\_KEY\_AWS=YOUR_AWS_SECRET_ACCESS_KEY
BUCKET\_NAME\_AWS=ride-results
S3\_BUCKET\_AWS=https://ride-results.s3-us-west-1.amazonaws.com/

To run the script:
node scripts/upload-results.js \<path to results JSON file\>

# Displaying ride results

Once the results have been uploaded to AWS, the route viewer app can display them using this URL:
[https://route-viewer.vercel.app/results/](https://route-viewer.vercel.app/results/test-feb-2025)\<title\>

Where \<title\> is the same as the value in the \-t argument given to the scraping command

If the results are malformed or missing critical information, the route viewer app will error out and you’ll need to troubleshoot it, starting with the error message in the browser dev console and then figuring out which specific JSON attributes are missing in the results.
