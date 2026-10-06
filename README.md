# AlpsCoinChain - Smart Investment Platform

A modern, fully-responsive cryptocurrency investment platform with a sleek dark theme and intuitive user interface.

## Features

✨ **Modern Design**
- Dark theme with gradient accents
- Smooth animations and transitions
- Fully responsive on all devices
- Professional typography with Space Grotesk and Inter fonts

🔐 **Investment Functionality**
- Portfolio vault system
- Deposit and withdraw features
- Multi-asset support (USDT, ETH, BTC)
- Real-time balance tracking
- Fee preview system

💰 **Token System**
- Native $ALPS token
- Staking rewards
- Governance voting
- Fee discounts

📊 **Dashboard Features**
- Portfolio balance overview
- Asset breakdown
- Transaction preview
- Connected wallet support (ready for Web3 integration)

## Getting Started

### Email setup (recommended: Resend)

1. Create a free Resend account at https://resend.com
2. Verify your sending domain or use a sandbox address for testing
3. Create an API key and copy it
4. Create a file named .env in the project root with:

```env
PORT=3000
RESEND_API_KEY=your_resend_api_key
FROM_EMAIL=hello@yourdomain.com
TO_EMAIL=your@email.com
```

5. Start the server:

```bash
npm start
```

6. Open the site and submit the contact form

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mithyable/alpscoinchain.git
   cd alpscoinchain
   ```

2. **Open in browser:**
   Simply open `index.html` in your web browser or serve using a local server:
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Python 2
   python -m SimpleHTTPServer 8000
   ```

3. **Visit:** http://localhost:8000

## Files Structure

- `index.html` - Main HTML structure
- `styles.css` - Complete styling and responsive design
- `script.js` - Interactive functionality and animations
- `README.md` - This file

## Customization

### Colors
Edit the CSS variables in `styles.css`:
```css
:root {
    --primary: #6366f1;
    --primary-dark: #4f46e5;
    --secondary: #10b981;
    /* ... more colors ... */
}
```

### Content
Edit the HTML sections in `index.html`:
- Hero section
- Features
- How it works
- Portfolio vault
- Token information
- About section

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers

## Web3 Integration

The platform is ready for Web3 integration. To add wallet connection:

1. Install Web3.js or ethers.js:
   ```bash
   npm install ethers
   ```

2. Update the `connectWallet()` function in `script.js`

3. Implement smart contract interactions for deposits/withdrawals

## Deployment

### GitHub Pages
1. Push to GitHub repository
2. Go to Settings → Pages
3. Select main branch as source
4. Your site will be live at: `https://mithyable.github.io/alpscoinchain`

### Other Platforms
- Vercel
- Netlify
- Any static hosting service

## License

© 2026 AlpsCoinChain. All rights reserved.

## Support

For issues or questions, please create an issue in the repository.

---

**Built with ❤️ by AlpsCoinChain**
Cloudflare deployment update.
