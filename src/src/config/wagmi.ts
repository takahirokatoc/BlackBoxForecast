import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'BlackBox Forecast',
  projectId: 'b1a3471de9d6427e8a9b24cf3d7685f2',
  chains: [sepolia],
  ssr: false,
});
