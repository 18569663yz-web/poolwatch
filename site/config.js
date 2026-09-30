// v3fees/site/config.js
// Owner: frontend-dev. One string, so nobody has to read app.js to change it.
//
// The tipping address shown in the banner at the very top of the page.
// Leave it empty and the banner says the address is still to be published.
// Fill it in and the banner changes on the next reload — nothing else to touch.

export const DONATION_ADDRESS = '0x5006d8d4e3e96c445882327921151190f7b34a7c';

// Where the source lives. Empty hides the GitHub link in the top navigation
// rather than pointing at a placeholder that goes nowhere.
export const SOURCE_URL = '';

// Uniswap's own interface. The tool never collects anything itself: it links
// here and the user signs in their own wallet.
export const UNISWAP_POSITIONS = 'https://app.uniswap.org/positions/v3/ethereum';
export const ETHERSCAN = 'https://etherscan.io';
