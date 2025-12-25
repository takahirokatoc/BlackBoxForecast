import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedForecast = await deploy("BlackBoxForecast", {
    from: deployer,
    log: true,
  });

  console.log(`BlackBoxForecast contract: `, deployedForecast.address);
};
export default func;
func.id = "deploy_black_box_forecast"; // id required to prevent reexecution
func.tags = ["BlackBoxForecast"];
