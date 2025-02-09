import { types } from "@algo-builder/web";
import { assert } from "chai";
import { RUNTIME_ERRORS } from "../../src/errors/errors-list";
import { AccountStore, Runtime } from "../../src/index";
import { useFixture } from "../helpers/integration";
import { expectRuntimeError } from "../helpers/runtime-errors";

describe("Pooled Transaction Fees Test", function () {
	useFixture("deploy-asa");
	const initialBalance = 1e30;
	let john: AccountStore;
	let bob: AccountStore;
	let elonUnfunded: AccountStore;
	let alice: AccountStore;
	let assetId: number;
	let runtime: Runtime;

	this.beforeEach(function () {
		john = new AccountStore(initialBalance, "john");
		bob = new AccountStore(initialBalance, "bob");
		alice = new AccountStore(initialBalance, "alice");
		elonUnfunded = new AccountStore(0, "elon");
		runtime = new Runtime([john, bob, alice, elonUnfunded]); // setup test
		assert.equal(elonUnfunded.balance(), BigInt(0));
	});

	function setupAsset(): void {
		// create asset
		assetId = runtime.deployASA("asa", {
			creator: { ...john.account, name: "john" },
		}).assetIndex;
	}

	// helper function
	function syncAccounts(): void {
		john = runtime.getAccount(john.address);
		bob = runtime.getAccount(bob.address);
		alice = runtime.getAccount(alice.address);
		elonUnfunded = runtime.getAccount(elonUnfunded.address);
	}

	it("Should pass if second account doesn't pay fees and first account is covering fees", function () {
		const amount = 1e4 + 122;
		const initialBalance = john.balance();
		// group with fee distribution
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 2000 },
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: bob.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 },
			},
		];

		assert.doesNotThrow(() => runtime.executeTx(groupTx));

		syncAccounts();
		assert.equal(bob.balance(), BigInt(initialBalance) + BigInt(amount));
		assert.equal(alice.balance(), BigInt(initialBalance));
		assert.equal(john.balance(), initialBalance - BigInt(amount) - 2000n);
	});

	it("Should fail if fees is not enough", function () {
		const amount = 1e4 + 122;
		// group with fee distribution
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 1000 },
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: bob.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 },
			},
		];

		// Fails if fees is not enough
		expectRuntimeError(
			() => runtime.executeTx(groupTx),
			RUNTIME_ERRORS.TRANSACTION.FEES_NOT_ENOUGH
		);
	});

	it("Should pass if two out of three doesn't pay the txn fee in a group txn of size three", function () {
		const amount = 4000;
		const fee = 3000;
		// group with fee distribution. Pooled transaction fee
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: fee }, // this covers fee of entire group txns.
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: bob.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 }, // with 0 txn fee.
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: bob.account,
				toAccountAddr: john.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 }, // with 0 txn fee.
			},
		];

		assert.doesNotThrow(() => runtime.executeTx(groupTx));

		syncAccounts();
		assert.equal(john.balance(), BigInt(initialBalance) - BigInt(fee));
		assert.equal(alice.balance(), BigInt(initialBalance));
		assert.equal(bob.balance(), BigInt(initialBalance));
	});

	it("Should unfunded accounts be able to issue transactions and opt-in", function () {
		setupAsset();
		const amount = 200000;
		const fee = 3000;
		// group with fee distribution
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: elonUnfunded.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: fee }, // this covers fee of entire group txns
			},
			{
				type: types.TransactionType.OptInASA,
				sign: types.SignType.SecretKey,
				fromAccount: elonUnfunded.account, // unfunded account
				assetID: assetId,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
		];

		assert.doesNotThrow(() => runtime.executeTx(groupTx));

		syncAccounts();
		assert(elonUnfunded.balance() !== BigInt(0));
		assert.equal(john.balance(), BigInt(initialBalance) - BigInt(amount));
		assert.equal(alice.balance(), BigInt(initialBalance) - BigInt(fee));
		assert.equal(elonUnfunded.balance(), BigInt(amount)); // unfunded account
		// verify holding
		assert.isDefined(elonUnfunded.getAssetHolding(assetId));
	});

	it("Should not fail when account in first txn of group txn is unfunded account and trying to opt-in", function () {
		setupAsset();
		const amount = 200000;
		const fee = 3000;
		// group with fee distribution
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.OptInASA,
				sign: types.SignType.SecretKey,
				fromAccount: elonUnfunded.account, // unfunded account
				assetID: assetId,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: elonUnfunded.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: fee }, // this covers fee of entire group txns
			}
		];

		assert.doesNotThrow(() => runtime.executeTx(groupTx));
		syncAccounts();
		assert.equal(alice.balance(), BigInt(initialBalance) - BigInt(fee));
		assert.equal(john.balance(), BigInt(initialBalance) - BigInt(amount));
		assert.equal(elonUnfunded.balance(), BigInt(amount));
		assert.isDefined(elonUnfunded.getAssetHolding(assetId));
	});

});

describe("Pooled Transaction Fees Test with App and Asset", function () {
	useFixture("stateful");
	const initialBalance = 1e30;
	let john: AccountStore;
	let bob: AccountStore;
	let elonUnfunded: AccountStore;
	let alice: AccountStore;
	let assetId: number;
	let approvalProgramFilename: string;
	let clearProgramFilename: string;
	let runtime: Runtime;

	this.beforeEach(function () {
		john = new AccountStore(initialBalance, "john");
		bob = new AccountStore(initialBalance, "bob");
		alice = new AccountStore(initialBalance, "alice");
		elonUnfunded = new AccountStore(0, "elonUnfunded");
		runtime = new Runtime([john, bob, alice, elonUnfunded]); // setup test

		approvalProgramFilename = "counter-approval.teal";
		clearProgramFilename = "clear.teal";
	});

	function setupAsset(): void {
		// create asset
		assetId = runtime.deployASA("gold", {
			creator: { ...john.account, name: "john" },
		}).assetIndex;
	}

	function setupApp(): void {
		// deploy new app
		runtime.deployApp(
			john.account,
			{
				appName: "app",
				metaType: types.MetaType.FILE,
				approvalProgramFilename,
				clearProgramFilename,
				globalBytes: 1,
				globalInts: 1,
				localBytes: 1,
				localInts: 1,
			},
			{}
		);
	}

	// helper function
	function syncAccounts(): void {
		john = runtime.getAccount(john.address);
		bob = runtime.getAccount(bob.address);
		alice = runtime.getAccount(alice.address);
		elonUnfunded = runtime.getAccount(elonUnfunded.address);
	}

	it("Should not fail when tried to optin to unfunded account in group txn", function () {
		setupAsset();
		const amount = 200000;
		const fee = 3000;
		// group with fee distribution
		const groupTx: types.ExecParams[] = [
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: john.account,
				toAccountAddr: alice.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
			{
				type: types.TransactionType.TransferAlgo,
				sign: types.SignType.SecretKey,
				fromAccount: alice.account,
				toAccountAddr: bob.address,
				amountMicroAlgos: amount,
				payFlags: { totalFee: fee }, // this covers fee of entire group txns
			},
			{
				type: types.TransactionType.OptInASA,
				sign: types.SignType.SecretKey,
				fromAccount: elonUnfunded.account, // unfunded account and no fund is sent to this account
				assetID: assetId,
				payFlags: { totalFee: 0 }, // with 0 txn fee
			},
		];
		assert.doesNotThrow(() => runtime.executeTx(groupTx));
		syncAccounts();
		assert.equal(alice.balance(), BigInt(initialBalance) - BigInt(fee));
		assert.equal(john.balance(), BigInt(initialBalance) - BigInt(amount));
		assert.equal(elonUnfunded.balance(), BigInt(0));
		assert.isDefined(elonUnfunded.getAssetHolding(assetId));
	});

	it("Should not fail when a funded account in txn group is trying cover the partial fee", function () {
		setupApp();
		const amount = 200000;
		const fee = 1999;
		const appInfo = runtime.getAppInfoFromName(approvalProgramFilename, clearProgramFilename);
		assert.isDefined(appInfo);
		if (appInfo !== undefined) {
			runtime.optInToApp(alice.address, appInfo.appID, {}, {});
			assert(runtime.getAccount(alice.address).getApp(appInfo.appID) === undefined);

			const groupTx: types.ExecParams[] = [
				{
					type: types.TransactionType.CallApp,
					sign: types.SignType.SecretKey,
					fromAccount: alice.account, // funded account
					appID: appInfo.appID,
					payFlags: { totalFee: 1 } // partially covering it's fee
				},
				{
					type: types.TransactionType.TransferAlgo,
					sign: types.SignType.SecretKey,
					fromAccount: john.account,
					toAccountAddr: elonUnfunded.address,
					amountMicroAlgos: amount,
					payFlags: { totalFee: fee }
				},
			];

			assert.doesNotThrow(() => runtime.executeTx(groupTx));
			syncAccounts();
			assert.equal(alice.balance(), BigInt(initialBalance) - BigInt(1));
			assert.equal(john.balance(), BigInt(initialBalance) - BigInt(amount) - BigInt(fee));
			assert.equal(elonUnfunded.balance(), BigInt(amount));
		}
	});

	it("Should fail when unfunded account is trying to cover it's own fee", function () {
		setupApp();
		const amount = 200000;
		const fee = 1999;
		const appInfo = runtime.getAppInfoFromName(approvalProgramFilename, clearProgramFilename);
		assert.isDefined(appInfo);
		if (appInfo !== undefined) {
			runtime.optInToApp(alice.address, appInfo.appID, {}, {});
			assert(runtime.getAccount(alice.address).getApp(appInfo.appID) === undefined);
			runtime.getAccount(alice.address).amount = BigInt(0); // set balance 0
			const groupTx: types.ExecParams[] = [
				{
					type: types.TransactionType.CallApp,
					sign: types.SignType.SecretKey,
					fromAccount: alice.account, // unfunded account
					appID: appInfo.appID,
					payFlags: { totalFee: 1 },
				},
				{
					type: types.TransactionType.TransferAlgo,
					sign: types.SignType.SecretKey,
					fromAccount: john.account,
					toAccountAddr: elonUnfunded.address,
					amountMicroAlgos: amount,
					payFlags: { totalFee: fee },
				},
			];
			// Fails as account in first txn in group txn is unfunded
			expectRuntimeError(
				() => runtime.executeTx(groupTx),
				RUNTIME_ERRORS.TRANSACTION.INSUFFICIENT_ACCOUNT_BALANCE
			);
		}
	});

});
