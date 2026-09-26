// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract Tabs is EIP712 {
    struct Tab {
        address payer;
        address signer;
        address payee;
        uint64 expiresAt;
        uint128 deposit;
        uint128 paid;
    }

    bytes32 public constant VOUCHER_TYPEHASH = keccak256("Voucher(uint256 tabId,uint128 total)");

    uint256 public tabCount;
    mapping(uint256 tabId => Tab) public tabs;

    event Opened(
        uint256 indexed tabId,
        address indexed payer,
        address indexed payee,
        address signer,
        uint128 deposit,
        uint64 expiresAt
    );
    event ToppedUp(uint256 indexed tabId, uint128 amount, uint64 expiresAt);
    event Charged(uint256 indexed tabId, uint128 total, uint128 amount);
    event Closed(uint256 indexed tabId, uint128 refund);

    error UnknownTab();
    error ZeroAddress();
    error ExpiryInPast();
    error ExpiryShortened();
    error NotPayer();
    error NotPayee();
    error NotExpired();
    error TotalNotAbovePaid();
    error TotalAboveDeposit();
    error BadSignature();
    error TransferFailed();

    constructor() EIP712("Arc Tabs", "1") {}

    function open(address payee, address signer, uint64 expiresAt) external payable returns (uint256 tabId) {
        if (payee == address(0) || signer == address(0)) revert ZeroAddress();
        if (expiresAt <= block.timestamp) revert ExpiryInPast();

        tabId = ++tabCount;
        uint128 deposit = uint128(msg.value);
        tabs[tabId] = Tab({
            payer: msg.sender, signer: signer, payee: payee, expiresAt: expiresAt, deposit: deposit, paid: 0
        });
        emit Opened(tabId, msg.sender, payee, signer, deposit, expiresAt);
    }

    function topUp(uint256 tabId, uint64 expiresAt) external payable {
        Tab storage tab = tabs[tabId];
        if (msg.sender != tab.payer) revert NotPayer();
        if (expiresAt < tab.expiresAt) revert ExpiryShortened();

        uint128 amount = uint128(msg.value);
        tab.deposit += amount;
        tab.expiresAt = expiresAt;
        emit ToppedUp(tabId, amount, expiresAt);
    }

    function charge(uint256 tabId, uint128 total, bytes calldata signature) external {
        Tab storage tab = tabs[tabId];
        uint128 amount = _acceptVoucher(tab, tabId, total, signature);
        emit Charged(tabId, total, amount);
        _send(tab.payee, amount);
    }

    function close(uint256 tabId, uint128 total, bytes calldata signature) external {
        Tab storage tab = tabs[tabId];
        if (msg.sender != tab.payee) revert NotPayee();

        uint128 amount = total > tab.paid ? _acceptVoucher(tab, tabId, total, signature) : 0;
        uint128 refund = _drain(tab);
        if (amount > 0) emit Charged(tabId, total, amount);
        emit Closed(tabId, refund);
        _send(tab.payee, amount);
        _send(tab.payer, refund);
    }

    function reclaim(uint256 tabId) external {
        Tab storage tab = tabs[tabId];
        if (tab.payer == address(0)) revert UnknownTab();
        if (block.timestamp < tab.expiresAt) revert NotExpired();

        uint128 refund = _drain(tab);
        emit Closed(tabId, refund);
        _send(tab.payer, refund);
    }

    function remaining(uint256 tabId) external view returns (uint128) {
        Tab storage tab = tabs[tabId];
        return tab.deposit - tab.paid;
    }

    function voucherDigest(uint256 tabId, uint128 total) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, tabId, total)));
    }

    function _acceptVoucher(Tab storage tab, uint256 tabId, uint128 total, bytes calldata signature)
        private
        returns (uint128 amount)
    {
        if (total <= tab.paid) revert TotalNotAbovePaid();
        if (total > tab.deposit) revert TotalAboveDeposit();
        if (!SignatureChecker.isValidSignatureNow(tab.signer, voucherDigest(tabId, total), signature)) {
            revert BadSignature();
        }

        amount = total - tab.paid;
        tab.paid = total;
    }

    function _drain(Tab storage tab) private returns (uint128 refund) {
        refund = tab.deposit - tab.paid;
        tab.deposit = tab.paid;
    }

    function _send(address to, uint128 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
