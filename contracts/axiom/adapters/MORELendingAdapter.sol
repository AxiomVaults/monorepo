// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/external/IMorePool.sol";
import "../interfaces/external/IMorePoolDataProvider.sol";

/// @title MORELendingAdapter
/// @notice Yield adapter: supplies WFLOW directly to MORE Markets (Aave V3-compatible)
///         and earns the variable supply APY. No leverage — the simplest possible yield source.
///
/// @dev Capital flow (deposit):
///      WFLOW from caller → MORE.supply(WFLOW, amount, this) → aWFLOW held here
///
/// @dev Capital flow (withdraw):
///      MORE.withdraw(WFLOW, amount, msg.sender) → WFLOW to caller
///      The aToken balance decreases by the proportional amount.
///
/// @dev Yield:
///      aWFLOW balance increases over time as interest accrues (Aave V3 rebasing aToken).
///      totalUnderlying() reads currentATokenBalance from the data provider, which
///      reflects principal + all accrued interest.
///
/// @custom:security nonReentrant on all state-mutating calls.
contract MORELendingAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error WithdrawFailed(uint256 requested, uint256 received);

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice WFLOW token — base asset this adapter accepts and returns
    IERC20 public immutable wflow;

    /// @notice MORE lending pool (Aave V3-compatible)
    IMorePool public immutable morePool;

    /// @notice MORE data provider — used to read aToken balance (principal + interest)
    IMorePoolDataProvider public immutable moreDataProvider;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param wflow_            WFLOW address (Flow EVM: 0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e)
    /// @param morePool_         MORE lending pool (Flow EVM: 0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d)
    /// @param moreDataProvider_ MORE data provider (Flow EVM: 0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf)
    constructor(
        address wflow_,
        address morePool_,
        address moreDataProvider_
    ) {
        if (wflow_ == address(0)) revert ZeroAddress();
        if (morePool_ == address(0)) revert ZeroAddress();
        if (moreDataProvider_ == address(0)) revert ZeroAddress();

        wflow            = IERC20(wflow_);
        morePool         = IMorePool(morePool_);
        moreDataProvider = IMorePoolDataProvider(moreDataProvider_);
    }

    // ─── IYieldAdapter ────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Pulls WFLOW from caller, then supplies it to MORE Markets.
    function deposit(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Pull WFLOW from caller (StrategyManager)
        wflow.safeTransferFrom(msg.sender, address(this), amount);

        // Supply to MORE Markets — receive aWFLOW (stays in this contract)
        wflow.safeIncreaseAllowance(address(morePool), amount);
        morePool.supply(address(wflow), amount, address(this), 0);

        emit Deposited(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Withdraws WFLOW from MORE Markets back to caller.
    function withdraw(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 preBal = wflow.balanceOf(address(this));
        morePool.withdraw(address(wflow), amount, address(this));
        uint256 received = wflow.balanceOf(address(this)) - preBal;

        if (received == 0) revert WithdrawFailed(amount, received);

        // Forward WFLOW to caller
        wflow.safeTransfer(msg.sender, received);

        emit Withdrew(msg.sender, received);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Withdraws the full aWFLOW position from MORE Markets.
    function withdrawAll() external override onlyOwner nonReentrant returns (uint256 total) {
        (uint256 aTokenBalance,,,,,,,,) = moreDataProvider.getUserReserveData(
            address(wflow), address(this)
        );

        if (aTokenBalance == 0) return 0;

        uint256 preBal = wflow.balanceOf(address(this));
        morePool.withdraw(address(wflow), type(uint256).max, address(this));
        total = wflow.balanceOf(address(this)) - preBal;

        if (total > 0) {
            wflow.safeTransfer(msg.sender, total);
        }

        emit Withdrew(msg.sender, total);
    }

    // ─── IYieldAdapter: View ──────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Returns the current aWFLOW balance — principal + all accrued interest.
    function totalUnderlying() external view override returns (uint256) {
        (uint256 aTokenBalance,,,,,,,,) = moreDataProvider.getUserReserveData(
            address(wflow), address(this)
        );
        return aTokenBalance;
    }

    /// @inheritdoc IYieldAdapter
    function baseAsset() external view override returns (address) {
        return address(wflow);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Recover any ERC-20 tokens accidentally sent to this contract.
    /// @dev Cannot recover WFLOW while a position is open (aTokens are not WFLOW).
    function rescueToken(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
