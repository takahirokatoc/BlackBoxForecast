import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { FhevmType } from "@fhevm/hardhat-plugin";

task("task:forecast-address", "Print deployed BlackBoxForecast address").setAction(async (_args: TaskArguments, hre) => {
  const forecast = await hre.deployments.get("BlackBoxForecast");
  console.log(`BlackBoxForecast address: ${forecast.address}`);
});

task("task:create-prediction", "Create a prediction with 2-4 options")
  .addParam("name", "Prediction title")
  .addParam("options", "Comma-separated option labels (2-4)")
  .setAction(async (args: TaskArguments, hre) => {
    const { ethers, deployments } = hre;
    const labels = (args.options as string).split(",").map((label: string) => label.trim());
    if (labels.length < 2 || labels.length > 4) {
      throw new Error("Please provide between 2 and 4 option labels");
    }

    const [signer] = await ethers.getSigners();
    const deployment = await deployments.get("BlackBoxForecast");
    const contract = await ethers.getContractAt("BlackBoxForecast", deployment.address);

    const tx = await contract.connect(signer).createPrediction(args.name as string, labels);
    console.log(`Creating prediction "${args.name}"... tx=${tx.hash}`);
    await tx.wait();
    console.log("Prediction created");
  });

task("task:place-bet", "Place an encrypted bet on a prediction")
  .addParam("prediction", "Prediction id")
  .addParam("choice", "Option index to encrypt")
  .addParam("stake", "Stake in ETH")
  .setAction(async (args: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    const predictionId = parseInt(args.prediction as string, 10);
    const optionIndex = parseInt(args.choice as string, 10);
    const value = ethers.parseEther(args.stake as string);

    const [signer] = await ethers.getSigners();
    const deployment = await deployments.get("BlackBoxForecast");
    const contract = await ethers.getContractAt("BlackBoxForecast", deployment.address);

    await fhevm.initializeCLIApi();
    const encryptedChoice = await fhevm
      .createEncryptedInput(deployment.address, signer.address)
      .add32(optionIndex)
      .encrypt();

    const tx = await contract
      .connect(signer)
      .placeBet(predictionId, encryptedChoice.handles[0], encryptedChoice.inputProof, { value });
    console.log(`Placing bet on prediction ${predictionId}... tx=${tx.hash}`);
    await tx.wait();
    console.log("Bet confirmed");
  });

task("task:decrypt-option", "Decrypt encrypted totals for an option")
  .addParam("prediction", "Prediction id")
  .addParam("option", "Option index")
  .setAction(async (args: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    const predictionId = parseInt(args.prediction as string, 10);
    const optionIndex = parseInt(args.option as string, 10);

    await fhevm.initializeCLIApi();
    const [signer] = await ethers.getSigners();

    const deployment = await deployments.get("BlackBoxForecast");
    const contract = await ethers.getContractAt("BlackBoxForecast", deployment.address);

    const totals = await contract.getOptionTotals(predictionId, optionIndex);
    const votes = await fhevm.userDecryptEuint(FhevmType.euint64, totals[0], deployment.address, signer);
    const stake = await fhevm.userDecryptEuint(FhevmType.euint128, totals[1], deployment.address, signer);

    console.log(`Prediction ${predictionId} option ${optionIndex}`);
    console.log(`Encrypted votes: ${totals[0]}`);
    console.log(`Decrypted votes: ${votes}`);
    console.log(`Encrypted stake: ${totals[1]}`);
    console.log(`Decrypted stake: ${stake}`);
  });
