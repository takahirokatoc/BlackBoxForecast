# BlackBoxForecast

BlackBoxForecast is an encrypted prediction market that lets anyone create a forecast with 2 to 4 outcomes, wager ETH
on a choice, and keep both selections and totals confidential on-chain using Zama FHE. The contract stores encrypted
vote counts and encrypted stake totals, while users can selectively decrypt their own data through the Zama relayer.

## Overview

Prediction markets are powerful, but transparency leaks signals early. Public bets can influence sentiment, allow
copying, and discourage honest participation. BlackBoxForecast solves this by encrypting choices and tallies so that
the market can function without leaking sensitive intent or capital allocation.

This repository includes:
- A Solidity smart contract that stores encrypted selections and encrypted aggregate totals.
- Hardhat deployment, tasks, and tests for local and Sepolia environments.
- A React + Vite frontend that uses Zama's relayer SDK for client-side encryption and decryption.

## Problems Solved

- **Privacy of intent**: Choices are encrypted before they reach the chain, preventing copy-trading and herding.
- **Confidential liquidity**: Total stakes per option are encrypted, removing real-time price signaling.
- **Trust-minimized storage**: All sensitive tallies stay on-chain as ciphertext, not in a private database.
- **User-controlled access**: Decryption requires a wallet signature, so users decide what to reveal.

## Key Advantages

- **End-to-end encrypted flow**: Choices, counts, and totals never appear in plaintext on-chain.
- **Composable on-chain state**: Encrypted totals are still verifiable and updatable within the contract.
- **Simple market creation**: Anyone can spin up a prediction with 2-4 outcomes in one transaction.
- **Transparent yet private**: The contract is public and auditable, while user inputs stay confidential.
- **No reliance on local storage**: The frontend avoids storing sensitive data in the browser.

## How It Works

1. The creator calls `createPrediction` with a name and 2-4 option labels.
2. A bettor encrypts their option index client-side using Zama's relayer SDK.
3. The contract stores the encrypted choice and updates encrypted vote counts and stake totals.
4. The bettor can request decryption of their own handles using an EIP-712 signature.
5. Option totals can be decrypted only by authorized users who request access.

## Core Features

- Create predictions with a human-readable title and 2-4 options.
- Place ETH-backed bets with encrypted selections.
- Maintain encrypted tallies of votes and total stakes per option.
- View prediction metadata and option labels on-chain in plaintext.
- Decrypt encrypted totals and personal bet data through the relayer flow.

## Architecture

### Smart Contract (`contracts/BlackBoxForecast.sol`)

- Uses Zama FHE types (`euint32`, `euint64`, `euint128`) to store selections and totals.
- Emits `PredictionCreated` and `BetPlaced` for observability without revealing data.
- Stores per-user encrypted bets for later self-decryption.
- Keeps totals confidential while still allowing on-chain aggregation.

### Frontend (`src/`)

- React + Vite UI with wallet connectivity (RainbowKit + wagmi).
- **Reads** are done with viem; **writes** are done with ethers.
- Zama relayer SDK handles encryption, ACL signatures, and decryption.
- Uses static contract configuration in `src/src/config/contracts.ts` (no JSON imports).

## Tech Stack

- **Smart contracts**: Solidity 0.8.x, FHEVM by Zama
- **Framework**: Hardhat + hardhat-deploy
- **Encryption**: `@fhevm/solidity` and `@zama-fhe/relayer-sdk`
- **Frontend**: React, Vite, RainbowKit, wagmi, viem, ethers
- **Testing**: Hardhat + FHEVM mock

## Project Structure

```
BlackBoxForecast/
├── contracts/                  # Smart contracts
│   └── BlackBoxForecast.sol
├── deploy/                     # Deployment scripts
├── tasks/                      # Hardhat CLI tasks
├── test/                       # Contract tests (FHEVM mock)
├── deployments/                # Deployment artifacts (Sepolia ABI lives here)
├── src/                        # Frontend app (React + Vite)
└── hardhat.config.ts
```

## Prerequisites

- Node.js 20+
- npm
- Sepolia ETH for deployment and testing

## Installation

Install contract dependencies at the repo root:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix src install
```

## Configuration

Contracts use a private key for deployments. Do not use a mnemonic.

Create a `.env` file at the repo root with:

```
PRIVATE_KEY=your_private_key
INFURA_API_KEY=your_infura_key
```

Optional Etherscan verification can be set via Hardhat vars:

```bash
npx hardhat vars set ETHERSCAN_API_KEY
```

## Compile and Test

```bash
npm run compile
npm run test
```

Note: Tests run against the FHEVM mock and will skip on non-mock networks.

## Deploy

Deploy to Sepolia:

```bash
npx hardhat deploy --network sepolia
```

Verify contract (optional):

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Frontend Setup

The frontend is hardwired to Sepolia. It does not connect to a localhost chain.

1. Copy the deployed ABI from `deployments/sepolia/BlackBoxForecast.json`.
2. Update `src/src/config/contracts.ts` with the new contract address and ABI.
3. Run the app:

```bash
npm --prefix src run dev
```

## CLI Tasks

Useful Hardhat tasks for interacting with the contract:

```bash
npx hardhat task:forecast-address
npx hardhat task:create-prediction --name "Will ETH hit $10k?" --options "Yes,No"
npx hardhat task:place-bet --prediction 0 --choice 1 --stake 0.1
npx hardhat task:decrypt-option --prediction 0 --option 1
```

## Future Roadmap

- Add resolution mechanics and payout distribution.
- Introduce oracle integration for automated settlement.
- Support multiple bets per user with richer analytics.
- Add role-based permissions for shared decryption workflows.
- Expand to multi-chain deployments and L2 networks.
- Improve UX with batch decrypt, history filters, and export tools.

## License

BSD-3-Clause-Clear. See `LICENSE`.
