import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">■</div>
        <div>
          <p className="brand-kicker">BlackBox Forecast</p>
          <h1 className="brand-title">Encrypted ETH predictions</h1>
        </div>
      </div>
      <ConnectButton />
    </header>
  );
}
