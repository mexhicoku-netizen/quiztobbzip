/* QuizToBBZip site settings.
 * Ads are OFF at launch. To switch them on later:
 *   1. set ADS_ENABLED = true
 *   2. put your AdSense publisher id in ADSENSE_CLIENT and the slot ids in AD_SLOTS
 *   3. edit ads.txt (replace pub-0000000000000000 with your id)
 * With ADS_ENABLED = false no ad script is loaded, no cookie banner is shown and the ad boxes stay hidden.
 */
window.QTZ_CONFIG = {
  SITE_NAME: "QuizToBBZip",
  ADS_ENABLED: false,
  ADSENSE_CLIENT: "ca-pub-0000000000000000",
  AD_SLOTS: { header: "", sidebar: "", footer: "" },
  CONTACT_EMAIL: "",           // optional: shown on the About and Privacy pages when filled in
  REPO_URL: ""                 // optional: link to the public GitHub repository
};
