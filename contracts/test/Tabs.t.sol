// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Tabs} from "../src/Tabs.sol";

contract RejectingReceiver {
    receive() external payable {
        revert();
    }
}

contract TabsTest is Test {
    Tabs internal tabs;

    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");
    uint256 internal signerKey = 0xA11CE;
    address internal signer = vm.addr(signerKey);

    uint128 internal constant DEPOSIT = 1 ether;
    uint64 internal expiresAt;

    function setUp() public {
        tabs = new Tabs();
        expiresAt = uint64(block.timestamp + 1 days);
        vm.deal(payer, 10 ether);
    }

    function _open() internal returns (uint256) {
        vm.prank(payer);
        return tabs.open{value: DEPOSIT}(payee, signer, expiresAt);
    }

    function _sign(uint256 key, uint256 tabId, uint128 total) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, tabs.voucherDigest(tabId, total));
        return abi.encodePacked(r, s, v);
    }

    function test_openStoresTab() public {
        uint256 tabId = _open();

        (address p, address s, address e, uint64 exp, uint128 deposit, uint128 paid) = tabs.tabs(tabId);
        assertEq(tabId, 1);
        assertEq(p, payer);
        assertEq(s, signer);
        assertEq(e, payee);
        assertEq(exp, expiresAt);
        assertEq(deposit, DEPOSIT);
        assertEq(paid, 0);
        assertEq(address(tabs).balance, DEPOSIT);
    }

    function test_openRejectsPastExpiry() public {
        vm.prank(payer);
        vm.expectRevert(Tabs.ExpiryInPast.selector);
        tabs.open{value: DEPOSIT}(payee, signer, uint64(block.timestamp));
    }

    function test_openRejectsZeroPayee() public {
        vm.prank(payer);
        vm.expectRevert(Tabs.ZeroAddress.selector);
        tabs.open{value: DEPOSIT}(address(0), signer, expiresAt);
    }

    function test_chargePaysDifferenceSinceLastVoucher() public {
        uint256 tabId = _open();

        tabs.charge(tabId, 0.3 ether, _sign(signerKey, tabId, 0.3 ether));
        tabs.charge(tabId, 0.5 ether, _sign(signerKey, tabId, 0.5 ether));

        assertEq(payee.balance, 0.5 ether);
        assertEq(tabs.remaining(tabId), 0.5 ether);
    }

    function test_chargeRejectsReplayedVoucher() public {
        uint256 tabId = _open();
        bytes memory voucher = _sign(signerKey, tabId, 0.3 ether);
        tabs.charge(tabId, 0.3 ether, voucher);

        vm.expectRevert(Tabs.TotalNotAbovePaid.selector);
        tabs.charge(tabId, 0.3 ether, voucher);
    }

    function test_chargeRejectsTotalAboveDeposit() public {
        uint256 tabId = _open();

        bytes memory voucher = _sign(signerKey, tabId, DEPOSIT + 1);
        vm.expectRevert(Tabs.TotalAboveDeposit.selector);
        tabs.charge(tabId, DEPOSIT + 1, voucher);
    }

    function test_chargeRejectsWrongSigner() public {
        uint256 tabId = _open();

        bytes memory voucher = _sign(0xB0B, tabId, 0.1 ether);
        vm.expectRevert(Tabs.BadSignature.selector);
        tabs.charge(tabId, 0.1 ether, voucher);
    }

    function test_chargeRejectsVoucherForOtherTab() public {
        uint256 first = _open();
        uint256 second = _open();

        bytes memory voucher = _sign(signerKey, first, 0.1 ether);
        vm.expectRevert(Tabs.BadSignature.selector);
        tabs.charge(second, 0.1 ether, voucher);
    }

    function test_closePaysPayeeAndRefundsPayer() public {
        uint256 tabId = _open();
        uint256 payerBefore = payer.balance;

        bytes memory voucher = _sign(signerKey, tabId, 0.25 ether);
        vm.prank(payee);
        tabs.close(tabId, 0.25 ether, voucher);

        assertEq(payee.balance, 0.25 ether);
        assertEq(payer.balance, payerBefore + 0.75 ether);
        assertEq(tabs.remaining(tabId), 0);
        assertEq(address(tabs).balance, 0);
    }

    function test_closeWithoutNewVoucherRefundsRest() public {
        uint256 tabId = _open();
        tabs.charge(tabId, 0.4 ether, _sign(signerKey, tabId, 0.4 ether));

        vm.prank(payee);
        tabs.close(tabId, 0, "");

        assertEq(payee.balance, 0.4 ether);
        assertEq(address(tabs).balance, 0);
    }

    function test_closeOnlyByPayee() public {
        uint256 tabId = _open();

        vm.prank(payer);
        vm.expectRevert(Tabs.NotPayee.selector);
        tabs.close(tabId, 0, "");
    }

    function test_reclaimRefundsAfterExpiry() public {
        uint256 tabId = _open();
        tabs.charge(tabId, 0.2 ether, _sign(signerKey, tabId, 0.2 ether));
        uint256 payerBefore = payer.balance;

        vm.warp(expiresAt);
        tabs.reclaim(tabId);

        assertEq(payer.balance, payerBefore + 0.8 ether);
        assertEq(tabs.remaining(tabId), 0);
    }

    function test_reclaimRejectsBeforeExpiry() public {
        uint256 tabId = _open();

        vm.expectRevert(Tabs.NotExpired.selector);
        tabs.reclaim(tabId);
    }

    function test_reclaimRejectsUnknownTab() public {
        vm.expectRevert(Tabs.UnknownTab.selector);
        tabs.reclaim(42);
    }

    function test_voucherStillPaysAfterExpiryUntilReclaimed() public {
        uint256 tabId = _open();

        vm.warp(expiresAt + 1);
        tabs.charge(tabId, 0.1 ether, _sign(signerKey, tabId, 0.1 ether));

        assertEq(payee.balance, 0.1 ether);
    }

    function test_topUpAddsDepositAndExtendsExpiry() public {
        uint256 tabId = _open();

        vm.prank(payer);
        tabs.topUp{value: 0.5 ether}(tabId, expiresAt + 1 days);

        (,,, uint64 exp, uint128 deposit,) = tabs.tabs(tabId);
        assertEq(deposit, DEPOSIT + 0.5 ether);
        assertEq(exp, expiresAt + 1 days);
    }

    function test_topUpRejectsShorterExpiry() public {
        uint256 tabId = _open();

        vm.prank(payer);
        vm.expectRevert(Tabs.ExpiryShortened.selector);
        tabs.topUp{value: 0.5 ether}(tabId, expiresAt - 1);
    }

    function test_topUpOnlyByPayer() public {
        uint256 tabId = _open();

        vm.deal(payee, 1 ether);
        vm.prank(payee);
        vm.expectRevert(Tabs.NotPayer.selector);
        tabs.topUp{value: 0.5 ether}(tabId, expiresAt);
    }

    function test_chargeRevertsWhenPayeeRejectsFunds() public {
        RejectingReceiver rejecting = new RejectingReceiver();
        vm.prank(payer);
        uint256 tabId = tabs.open{value: DEPOSIT}(address(rejecting), signer, expiresAt);

        bytes memory voucher = _sign(signerKey, tabId, 0.1 ether);
        vm.expectRevert(Tabs.TransferFailed.selector);
        tabs.charge(tabId, 0.1 ether, voucher);
    }

    function testFuzz_payeePlusRefundEqualsDeposit(uint128 deposit, uint128 total) public {
        deposit = uint128(bound(deposit, 1, 5 ether));
        total = uint128(bound(total, 1, deposit));
        vm.prank(payer);
        uint256 tabId = tabs.open{value: deposit}(payee, signer, expiresAt);
        uint256 payerBefore = payer.balance;

        bytes memory voucher = _sign(signerKey, tabId, total);
        vm.prank(payee);
        tabs.close(tabId, total, voucher);

        assertEq(payee.balance + (payer.balance - payerBefore), deposit);
        assertEq(address(tabs).balance, 0);
    }
}
