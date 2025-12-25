import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { BlackBoxForecast, BlackBoxForecast__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("BlackBoxForecast")) as BlackBoxForecast__factory;
  const contract = (await factory.deploy()) as BlackBoxForecast;
  const address = await contract.getAddress();

  return { contract, address };
}

describe("BlackBoxForecast", () => {
  let signers: Signers;
  let contract: BlackBoxForecast;
  let contractAddress: string;

  before(async () => {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite only runs against the FHEVM mock");
      this.skip();
    }

    ({ contract, address: contractAddress } = await deployFixture());
  });

  it("creates predictions with encrypted zeroed totals", async () => {
    const labels = ["Red", "Blue", "Green"];
    const tx = await contract.connect(signers.deployer).createPrediction("Favorite color", labels);
    await tx.wait();

    const count = await contract.predictionCount();
    expect(count).to.eq(1n);

    const prediction = await contract.getPrediction(0);
    expect(prediction[0]).to.eq("Favorite color");
    expect(prediction[1]).to.eq(labels.length);

    const fetchedLabels = await contract.getPredictionOptions(0);
    expect(fetchedLabels).to.deep.eq(labels);

    const totals = await contract.getOptionTotals(0, 0);
    const decryptedVotes = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      totals[0],
      contractAddress,
      signers.deployer,
    );
    const decryptedStake = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      totals[1],
      contractAddress,
      signers.deployer,
    );

    expect(decryptedVotes).to.eq(0);
    expect(decryptedStake).to.eq(0);
  });

  it("accepts encrypted bets and updates encrypted totals", async () => {
    const labels = ["Option A", "Option B"];
    await (await contract.connect(signers.deployer).createPrediction("Test prediction", labels)).wait();

    const encryptedChoice = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add32(1)
      .encrypt();

    const stake = ethers.parseEther("0.5");
    await (
      await contract
        .connect(signers.alice)
        .placeBet(0, encryptedChoice.handles[0], encryptedChoice.inputProof, { value: stake })
    ).wait();

    const optionZeroTotals = await contract.getOptionTotals(0, 0);
    const optionOneTotals = await contract.getOptionTotals(0, 1);

    const votesZero = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      optionZeroTotals[0],
      contractAddress,
      signers.alice,
    );
    const votesOne = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      optionOneTotals[0],
      contractAddress,
      signers.alice,
    );

    const stakeZero = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      optionZeroTotals[1],
      contractAddress,
      signers.alice,
    );
    const stakeOne = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      optionOneTotals[1],
      contractAddress,
      signers.alice,
    );

    expect(votesZero).to.eq(0);
    expect(votesOne).to.eq(1);
    expect(stakeZero).to.eq(0);
    expect(stakeOne).to.eq(stake);

    const bet = await contract.getUserBet(0, signers.alice.address, 0);
    const decryptedSelection = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      bet[0],
      contractAddress,
      signers.alice,
    );
    const decryptedUserStake = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      bet[1],
      contractAddress,
      signers.alice,
    );

    expect(decryptedSelection).to.eq(1);
    expect(decryptedUserStake).to.eq(stake);
    expect(bet[2]).to.be.gt(0);
  });
});
