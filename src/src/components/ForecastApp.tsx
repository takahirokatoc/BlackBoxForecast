import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { Contract, ethers } from 'ethers';
import { Header } from './Header';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import '../styles/Forecast.css';

type Prediction = {
  id: number;
  name: string;
  createdAt: number;
  options: string[];
};

type OptionStat = {
  encryptedVotes: string;
  encryptedStake: string;
  votes?: string;
  stake?: string;
};

type UserBet = {
  selectionHandle: string;
  stakeHandle: string;
  placedAt: number;
  selection?: string;
  stake?: string;
};

export function ForecastApp() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: encryptionLoading, error: encryptionError } = useZamaInstance();

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);
  const [decryptingKey, setDecryptingKey] = useState<string | null>(null);
  const [optionStats, setOptionStats] = useState<Record<string, OptionStat>>({});
  const [userBets, setUserBets] = useState<Record<number, UserBet[]>>({});
  const [formTitle, setFormTitle] = useState('');
  const [optionInputs, setOptionInputs] = useState(['', '']);
  const [stakes, setStakes] = useState<Record<number, string>>({});
  const [selections, setSelections] = useState<Record<number, number>>({});
  const [contractReady, setContractReady] = useState<boolean | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const formatDate = (timestamp: number) => new Date(timestamp * 1000).toLocaleString();
  const formatEth = (value: string | bigint | number) => {
    try {
      return `${ethers.formatEther(value)} ETH`;
    } catch {
      return `${value} wei`;
    }
  };

  const refreshKey = useMemo(() => predictions.length, [predictions.length]);

  const verifyContractPresence = useCallback(async () => {
    if (!publicClient) return;
    try {
      const bytecode = await publicClient.getBytecode({ address: CONTRACT_ADDRESS });
      setContractReady(Boolean(bytecode));
    } catch (err) {
      console.error('Contract check failed', err);
      setContractReady(false);
    }
  }, [publicClient]);

  const loadPredictions = useCallback(async () => {
    if (!publicClient) return;
    setLoadingPredictions(true);
    try {
      const count = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'predictionCount',
      })) as bigint;

      const loaded: Prediction[] = [];
      for (let i = 0n; i < count; i++) {
        const [name, optionCount, createdAt] = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getPrediction',
          args: [i],
        })) as [string, bigint, bigint];

        const options = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getPredictionOptions',
          args: [i],
        })) as string[];

        loaded.push({
          id: Number(i),
          name,
          createdAt: Number(createdAt),
          options: options.slice(0, Number(optionCount)),
        });
      }

      setPredictions(loaded);
    } catch (err) {
      console.error('Failed to load predictions', err);
    } finally {
      setLoadingPredictions(false);
    }
  }, [publicClient]);

  const loadUserBets = useCallback(async () => {
    if (!publicClient || !address) {
      setUserBets({});
      return;
    }

    const bets: Record<number, UserBet[]> = {};
    for (const prediction of predictions) {
      try {
        const count = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getUserBetCount',
          args: [prediction.id, address],
        })) as bigint;

        if (count === 0n) continue;

        const entries: UserBet[] = [];
        for (let i = 0n; i < count; i++) {
          const bet = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getUserBet',
            args: [prediction.id, address, i],
          })) as [string, string, bigint];

          entries.push({
            selectionHandle: bet[0],
            stakeHandle: bet[1],
            placedAt: Number(bet[2]),
          });
        }
        bets[prediction.id] = entries;
      } catch (err) {
        console.error('Failed to load user bets', err);
      }
    }

    setUserBets(bets);
  }, [address, predictions, publicClient]);

  useEffect(() => {
    verifyContractPresence();
  }, [verifyContractPresence]);

  useEffect(() => {
    loadPredictions();
  }, [loadPredictions]);

  useEffect(() => {
    setSelections(prev => {
      const next = { ...prev };
      predictions.forEach(prediction => {
        if (next[prediction.id] === undefined) {
          next[prediction.id] = 0;
        }
      });
      return next;
    });
  }, [predictions]);

  useEffect(() => {
    loadUserBets();
  }, [loadUserBets, refreshKey, address]);

  const decryptHandles = useCallback(
    async (handles: string[]) => {
      if (!instance || !address) {
        throw new Error('Encryption services not ready');
      }
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet not connected');
      }

      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESS];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      return instance.userDecrypt(
        handles.map(handle => ({ handle, contractAddress: CONTRACT_ADDRESS })),
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays
      );
    },
    [address, instance, signerPromise]
  );

  const decryptOption = useCallback(
    async (predictionId: number, optionIndex: number) => {
      if (!publicClient) return;
      setDecryptingKey(`${predictionId}-${optionIndex}`);
      try {
        const totals = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getOptionTotals',
          args: [BigInt(predictionId), BigInt(optionIndex)],
        })) as [string, string];

        const handles = [totals[0], totals[1]];
        const decrypted = await decryptHandles(handles);

        setOptionStats(prev => ({
          ...prev,
          [`${predictionId}-${optionIndex}`]: {
            encryptedVotes: totals[0],
            encryptedStake: totals[1],
            votes: decrypted[totals[0]] ?? '0',
            stake: decrypted[totals[1]] ?? '0',
          },
        }));
      } catch (err) {
        console.error('Decryption failed', err);
      } finally {
        setDecryptingKey(null);
      }
    },
    [decryptHandles, publicClient]
  );

  const decryptBet = useCallback(
    async (predictionId: number, betIndex: number) => {
      const betsForPrediction = userBets[predictionId];
      if (!betsForPrediction) return;
      setDecryptingKey(`bet-${predictionId}-${betIndex}`);

      try {
        const bet = betsForPrediction[betIndex];
        const decrypted = await decryptHandles([bet.selectionHandle, bet.stakeHandle]);

        const updated = betsForPrediction.map((entry, idx) =>
          idx === betIndex
            ? {
                ...entry,
                selection: decrypted[bet.selectionHandle] ?? '0',
                stake: decrypted[bet.stakeHandle] ?? '0',
              }
            : entry
        );

        setUserBets(prev => ({ ...prev, [predictionId]: updated }));
      } catch (err) {
        console.error('Failed to decrypt bet', err);
      } finally {
        setDecryptingKey(null);
      }
    },
    [decryptHandles, userBets]
  );

  const handleCreatePrediction = async () => {
    if (!isConnected) {
      setActionMessage('Connect your wallet to create a prediction');
      return;
    }

    const signer = await signerPromise;
    if (!signer) return;

    const filteredOptions = optionInputs.map(o => o.trim()).filter(Boolean);
    if (filteredOptions.length < 2 || filteredOptions.length > 4) {
      setActionMessage('Provide between 2 and 4 options');
      return;
    }
    if (!formTitle.trim()) {
      setActionMessage('Prediction title required');
      return;
    }

    setCreating(true);
    setActionMessage('Creating encrypted prediction...');
    try {
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createPrediction(formTitle.trim(), filteredOptions);
      await tx.wait();

      setFormTitle('');
      setOptionInputs(['', '']);
      setActionMessage('Prediction created');
      await loadPredictions();
    } catch (err) {
      console.error('Create prediction failed', err);
      setActionMessage('Transaction failed');
    } finally {
      setCreating(false);
    }
  };

  const handlePlaceBet = async (predictionId: number, optionIndex: number) => {
    if (!instance || encryptionLoading) {
      setActionMessage('Encryption SDK still loading');
      return;
    }
    if (!isConnected) {
      setActionMessage('Connect a wallet to place bets');
      return;
    }

    const signer = await signerPromise;
    if (!signer) return;

    const stake = stakes[predictionId];
    const parsedStake = stake ? ethers.parseEther(stake) : 0n;
    if (parsedStake <= 0) {
      setActionMessage('Enter a stake greater than 0');
      return;
    }

    setPlacing(`${predictionId}-${optionIndex}`);
    setActionMessage('Encrypting your pick...');

    try {
      const input = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
      input.add32(optionIndex);
      const encrypted = await input.encrypt();

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.placeBet(predictionId, encrypted.handles[0], encrypted.inputProof, {
        value: parsedStake,
      });
      await tx.wait();

      setActionMessage('Bet submitted');
      await loadPredictions();
      await loadUserBets();
    } catch (err) {
      console.error('Bet failed', err);
      setActionMessage('Bet transaction failed');
    } finally {
      setPlacing(null);
    }
  };

  const addOptionField = () => {
    if (optionInputs.length >= 4) return;
    setOptionInputs(prev => [...prev, '']);
  };

  const removeOptionField = (index: number) => {
    if (optionInputs.length <= 2) return;
    setOptionInputs(prev => prev.filter((_, idx) => idx !== index));
  };

  const contractStatusMessage = useMemo(() => {
    if (contractReady === null) return 'Checking on-chain deployment...';
    if (contractReady) return 'Contract is reachable on Sepolia';
    return 'Contract bytecode not found on Sepolia. Deploy with your PRIVATE_KEY to activate the app.';
  }, [contractReady]);

  return (
    <div className="app-shell">
      <Header />

      <section className="hero">
        <div>
          <p className="eyebrow">Encrypted prediction market</p>
          <h2>Spin up private forecasts and back your pick with ETH</h2>
          <p className="lede">
            Options and stakes stay encrypted with Zama FHE. Create a forecast, encrypt your choice, and keep tallies
            private until you decrypt them.
          </p>
          <div className="status-line">
            <span className={`status-dot ${contractReady ? 'ok' : 'warn'}`} />
            <span>{contractStatusMessage}</span>
          </div>
          {encryptionError && <p className="error-text">Relayer error: {encryptionError}</p>}
        </div>
        <div className="panel">
          <h3>Create prediction</h3>
          <label className="field-label">Title</label>
          <input
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            placeholder="Ex: Will ETH flip BTC by 2030?"
            className="text-input"
          />

          <div className="options-stack">
            <div className="options-header">
              <span>Options</span>
              <button className="ghost-btn" onClick={addOptionField} disabled={optionInputs.length >= 4}>
                + add
              </button>
            </div>
            {optionInputs.map((opt, idx) => (
              <div key={idx} className="option-row">
                <input
                  value={opt}
                  onChange={e =>
                    setOptionInputs(prev => prev.map((item, index) => (index === idx ? e.target.value : item)))
                  }
                  placeholder={`Option ${idx + 1}`}
                  className="text-input"
                />
                {optionInputs.length > 2 && (
                  <button className="ghost-btn danger" onClick={() => removeOptionField(idx)}>
                    remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <button className="primary-btn" onClick={handleCreatePrediction} disabled={creating}>
            {creating ? 'Submitting...' : 'Publish prediction'}
          </button>
          <p className="hint">2-4 options. Everything except ETH amounts stays encrypted on-chain.</p>
        </div>
      </section>

      <section className="content-grid">
        <div className="grid-left">
          <div className="section-header">
            <h3>Live predictions</h3>
            <span className="badge">{predictions.length} listed</span>
          </div>
          {loadingPredictions && <p className="muted">Loading predictions...</p>}
          {!loadingPredictions && predictions.length === 0 && (
            <p className="muted">No predictions yet. Start one above.</p>
          )}

          <div className="card-grid">
            {predictions.map(prediction => (
              <div key={prediction.id} className="card">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Prediction #{prediction.id + 1}</p>
                    <h4>{prediction.name}</h4>
                    <p className="muted">Created {formatDate(prediction.createdAt)}</p>
                  </div>
                  <span className="badge subtle">{prediction.options.length} options</span>
                </div>

                <div className="options-list">
                  {prediction.options.map((opt, idx) => {
                    const statKey = `${prediction.id}-${idx}`;
                    const stat = optionStats[statKey];
                    return (
                      <div key={idx} className="option-row tight">
                        <div>
                          <p className="option-label">
                            {idx + 1}. {opt}
                          </p>
                          {stat && (
                            <p className="muted small">
                              votes: {stat.votes ?? '—'} | stake: {stat.stake ? formatEth(stat.stake) : '—'}
                            </p>
                          )}
                        </div>
                        <div className="option-actions">
                          <button
                            className="ghost-btn"
                            onClick={() => decryptOption(prediction.id, idx)}
                            disabled={decryptingKey === `${prediction.id}-${idx}` || !isConnected}
                          >
                            {decryptingKey === `${prediction.id}-${idx}` ? 'Decrypting...' : 'Decrypt totals'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bet-panel">
                  <label className="field-label">Pick an option</label>
                  <div className="bet-controls">
                    <select
                      className="text-input"
                      value={selections[prediction.id] ?? 0}
                      onChange={e =>
                        setSelections(prev => ({
                          ...prev,
                          [prediction.id]: Number(e.target.value),
                        }))
                      }
                    >
                      {prediction.options.map((opt, idx) => (
                        <option key={idx} value={idx}>
                          {idx + 1}. {opt}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Stake in ETH"
                      className="text-input"
                      value={stakes[prediction.id] ?? ''}
                      onChange={e =>
                        setStakes(prev => ({
                          ...prev,
                          [prediction.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <button
                    className="primary-btn"
                    onClick={() => handlePlaceBet(prediction.id, selections[prediction.id] ?? 0)}
                    disabled={placing === `${prediction.id}-${selections[prediction.id] ?? 0}`}
                  >
                    {placing === `${prediction.id}-${selections[prediction.id] ?? 0}`
                      ? 'Submitting bet...'
                      : 'Encrypt & place bet'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid-right">
          <div className="card sticky">
            <h3>My encrypted bets</h3>
            {!isConnected && <p className="muted">Connect to see your bets.</p>}
            {isConnected && Object.keys(userBets).length === 0 && <p className="muted">No bets yet.</p>}

            {Object.entries(userBets).map(([predictionId, bets]) => (
              <div key={predictionId} className="bet-list">
                <p className="eyebrow">Prediction #{Number(predictionId) + 1}</p>
                {bets.map((bet, idx) => (
                  <div key={idx} className="bet-row">
                    <div>
                      <p className="muted small">Placed {formatDate(bet.placedAt)}</p>
                      <p className="muted small">
                        Selection handle: {bet.selectionHandle.slice(0, 12)}... | Stake handle:{' '}
                        {bet.stakeHandle.slice(0, 12)}...
                      </p>
                      {bet.selection && bet.stake && (
                        <p className="muted small">
                          Choice #{Number(bet.selection) + 1} | Stake {formatEth(bet.stake)}
                        </p>
                      )}
                    </div>
                    <button
                      className="ghost-btn"
                      onClick={() => decryptBet(Number(predictionId), idx)}
                      disabled={decryptingKey === `bet-${predictionId}-${idx}`}
                    >
                      {decryptingKey === `bet-${predictionId}-${idx}` ? 'Decrypting...' : 'Decrypt bet'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="card">
            <h3>How encryption flows</h3>
            <ul className="bullet-list">
              <li>Option picks are encrypted client-side before hitting the contract.</li>
              <li>Vote counts and ETH totals live on-chain as ciphertext.</li>
              <li>Use the decrypt actions to request ACL access and reveal your own data.</li>
            </ul>
            <p className="muted small">
              SDK status: {encryptionLoading ? 'initializing relayer...' : 'ready'} {encryptionError && `(${encryptionError})`}
            </p>
          </div>

          {actionMessage && <div className="callout">{actionMessage}</div>}
        </div>
      </section>
    </div>
  );
}
