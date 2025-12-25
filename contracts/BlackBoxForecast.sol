// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint32, euint64, euint128, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title BlackBoxForecast - encrypted prediction market
/// @notice Users create predictions with 2-4 options and place encrypted bets funded with ETH.
/// Encrypted counts and stakes are kept on-chain.
contract BlackBoxForecast is ZamaEthereumConfig {
    uint8 internal constant MIN_OPTIONS = 2;
    uint8 internal constant MAX_OPTIONS = 4;

    struct OptionData {
        string label;
        euint64 encryptedVoteCount;
        euint128 encryptedTotalStake;
    }

    struct Bet {
        euint32 encryptedSelection;
        euint128 encryptedStake;
        uint256 placedAt;
    }

    struct Prediction {
        string name;
        OptionData[] options;
        mapping(address => Bet[]) userBets;
        bool exists;
        uint256 createdAt;
    }

    Prediction[] private _predictions;

    event PredictionCreated(uint256 indexed predictionId, string name, string[] options);
    event BetPlaced(uint256 indexed predictionId, address indexed bettor, euint32 selection, euint128 stake);

    /// @notice Creates a new prediction with 2 to 4 options.
    /// @param name Human readable prediction title.
    /// @param optionLabels The option labels for users to choose from.
    /// @return predictionId The identifier of the created prediction.
    function createPrediction(string memory name, string[] memory optionLabels) external returns (uint256 predictionId) {
        require(bytes(name).length > 0, "Prediction name required");
        require(optionLabels.length >= MIN_OPTIONS && optionLabels.length <= MAX_OPTIONS, "Invalid option count");

        predictionId = _predictions.length;
        _predictions.push();
        Prediction storage prediction = _predictions[predictionId];
        prediction.name = name;
        prediction.exists = true;
        prediction.createdAt = block.timestamp;

        for (uint256 i = 0; i < optionLabels.length; i++) {
            require(bytes(optionLabels[i]).length > 0, "Option label required");

            prediction.options.push();
            OptionData storage option = prediction.options[i];
            option.label = optionLabels[i];
            option.encryptedVoteCount = FHE.asEuint64(0);
            option.encryptedTotalStake = FHE.asEuint128(0);
            FHE.allowThis(option.encryptedVoteCount);
            FHE.allowThis(option.encryptedTotalStake);
            FHE.allow(option.encryptedVoteCount, msg.sender);
            FHE.allow(option.encryptedTotalStake, msg.sender);
        }

        emit PredictionCreated(predictionId, name, optionLabels);
    }

    /// @notice Places an encrypted bet on a prediction.
    /// @param predictionId The prediction identifier.
    /// @param encryptedSelection Encrypted option index chosen by the bettor.
    /// @param selectionProof Zama proof for the encrypted selection.
    function placeBet(
        uint256 predictionId,
        externalEuint32 encryptedSelection,
        bytes calldata selectionProof
    ) external payable {
        require(predictionId < _predictions.length, "Unknown prediction");
        require(msg.value > 0, "Stake required");
        require(msg.value <= type(uint128).max, "Stake too large");

        Prediction storage prediction = _predictions[predictionId];
        require(prediction.exists, "Prediction inactive");
        uint256 optionCount = prediction.options.length;
        require(optionCount > 0, "No options configured");

        euint32 validatedSelection = FHE.fromExternal(encryptedSelection, selectionProof);
        euint128 encryptedStake = FHE.asEuint128(uint128(msg.value));

        Bet storage bet = prediction.userBets[msg.sender].push();
        bet.encryptedSelection = validatedSelection;
        bet.encryptedStake = encryptedStake;
        bet.placedAt = block.timestamp;

        FHE.allowThis(validatedSelection);
        FHE.allow(validatedSelection, msg.sender);
        FHE.allowThis(encryptedStake);
        FHE.allow(encryptedStake, msg.sender);

        for (uint256 i = 0; i < optionCount; i++) {
            OptionData storage option = prediction.options[i];
            ebool isSelected = FHE.eq(validatedSelection, FHE.asEuint32(uint32(i)));

            euint64 incrementedVotes = FHE.add(option.encryptedVoteCount, FHE.asEuint64(1));
            option.encryptedVoteCount = FHE.select(isSelected, incrementedVotes, option.encryptedVoteCount);
            FHE.allowThis(option.encryptedVoteCount);
            FHE.allow(option.encryptedVoteCount, msg.sender);

            euint128 increasedStake = FHE.add(option.encryptedTotalStake, encryptedStake);
            option.encryptedTotalStake = FHE.select(isSelected, increasedStake, option.encryptedTotalStake);
            FHE.allowThis(option.encryptedTotalStake);
            FHE.allow(option.encryptedTotalStake, msg.sender);
        }

        emit BetPlaced(predictionId, msg.sender, validatedSelection, encryptedStake);
    }

    /// @notice Returns the number of configured predictions.
    function predictionCount() external view returns (uint256) {
        return _predictions.length;
    }

    /// @notice Returns summary info for a prediction.
    function getPrediction(
        uint256 predictionId
    ) external view returns (string memory name, uint256 optionCount, uint256 createdAt) {
        _validatePrediction(predictionId);
        Prediction storage prediction = _predictions[predictionId];
        return (prediction.name, prediction.options.length, prediction.createdAt);
    }

    /// @notice Returns the option labels of a prediction.
    function getPredictionOptions(uint256 predictionId) external view returns (string[] memory optionLabels) {
        _validatePrediction(predictionId);
        Prediction storage prediction = _predictions[predictionId];
        uint256 optionCount = prediction.options.length;
        optionLabels = new string[](optionCount);

        for (uint256 i = 0; i < optionCount; i++) {
            optionLabels[i] = prediction.options[i].label;
        }
    }

    /// @notice Returns encrypted vote count and total stake for an option.
    function getOptionTotals(
        uint256 predictionId,
        uint256 optionIndex
    ) external view returns (euint64 encryptedVotes, euint128 encryptedStakes) {
        _validatePrediction(predictionId);
        Prediction storage prediction = _predictions[predictionId];
        require(optionIndex < prediction.options.length, "Option out of range");

        OptionData storage option = prediction.options[optionIndex];
        return (option.encryptedVoteCount, option.encryptedTotalStake);
    }

    /// @notice Returns the number of bets a user placed on a prediction.
    function getUserBetCount(uint256 predictionId, address bettor) external view returns (uint256) {
        _validatePrediction(predictionId);
        Prediction storage prediction = _predictions[predictionId];
        return prediction.userBets[bettor].length;
    }

    /// @notice Returns a specific bet for a user.
    function getUserBet(
        uint256 predictionId,
        address bettor,
        uint256 betIndex
    ) external view returns (euint32 selection, euint128 stake, uint256 placedAt) {
        _validatePrediction(predictionId);
        Prediction storage prediction = _predictions[predictionId];
        require(betIndex < prediction.userBets[bettor].length, "Bet out of range");

        Bet storage bet = prediction.userBets[bettor][betIndex];
        return (bet.encryptedSelection, bet.encryptedStake, bet.placedAt);
    }

    function _validatePrediction(uint256 predictionId) private view {
        require(predictionId < _predictions.length, "Unknown prediction");
        require(_predictions[predictionId].exists, "Prediction inactive");
    }
}
