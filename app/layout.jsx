import './globals.css';

export const metadata = {
  title: 'NSE Intraday Bias Terminal',
  description: 'Institutional Grade Intraday Multi-Factor Sentiment Terminal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}