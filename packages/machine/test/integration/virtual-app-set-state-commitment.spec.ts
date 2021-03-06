import AppRegistry from "@counterfactual/contracts/build/AppRegistry.json";
import ETHBucket from "@counterfactual/contracts/build/ETHBucket.json";
import StateChannelTransaction from "@counterfactual/contracts/build/StateChannelTransaction.json";
import { AssetType, NetworkContext } from "@counterfactual/types";
import * as chai from "chai";
import * as matchers from "ethereum-waffle/dist/matchers/matchers";
import { Contract, Wallet } from "ethers";
import { AddressZero, WeiPerEther } from "ethers/constants";
import { Signature, SigningKey } from "ethers/utils";

import { xkeysToSortedKthSigningKeys } from "../../src";
import { VirtualAppSetStateCommitment } from "../../src/ethereum/virtual-app-set-state-commitment";
import { AppInstance, StateChannel } from "../../src/models";

import { toBeEq } from "./bignumber-jest-matcher";
import { connectToGanache } from "./connect-ganache";
import { getRandomHDNodes } from "./random-signing-keys";
import { WaffleLegacyOutput } from "./waffle-type";

// To be honest, 30000 is an arbitrary large number that has never failed
// to reach the done() call in the test case, not intelligently chosen
const JEST_TEST_WAIT_TIME = 30000;

// The AppRegistry.setState call _could_ be estimated but we haven't
// written this test to do that yet
const SETSTATE_COMMITMENT_GAS = 6e9;

// The app nonce that the intermediary signs
const EXPIRY_NONCE = 65536;

let networkId: number;
let wallet: Wallet;
let network: NetworkContext;
let appRegistry: Contract;

let multisigOwnerKeys: SigningKey[];
let targetAppInstance: AppInstance;
let intermediaryCommitment: VirtualAppSetStateCommitment;
let intermediarySignature: Signature;

expect.extend({ toBeEq });

const expect2 = chai.use(matchers.default).expect;

beforeAll(async () => {
  [{}, wallet, networkId] = await connectToGanache();

  const relevantArtifacts = [
    { contractName: "AppRegistry", ...AppRegistry },
    { contractName: "ETHBucket", ...ETHBucket },
    { contractName: "StateChannelTransaction", ...StateChannelTransaction }
  ];

  network = {
    // Fetches the values from build artifacts of the contracts needed
    // for this test and sets the ones we don't care about to 0x0
    ETHBalanceRefund: AddressZero,
    ...relevantArtifacts.reduce(
      (accumulator: { [x: string]: string }, artifact: WaffleLegacyOutput) => ({
        ...accumulator,
        [artifact.contractName as string]: artifact.networks![networkId].address
      }),
      {}
    )
  } as NetworkContext;

  appRegistry = new Contract(
    (AppRegistry as WaffleLegacyOutput).networks![networkId].address,
    AppRegistry.abi,
    wallet
  );
});

beforeEach(() => {
  const xkeys = getRandomHDNodes(2);

  multisigOwnerKeys = xkeysToSortedKthSigningKeys(
    xkeys.map(x => x.extendedKey),
    0
  );

  const stateChannel = StateChannel.setupChannel(
    network.ETHBucket,
    AddressZero,
    xkeys.map(x => x.neuter().extendedKey)
  ).setFreeBalance(AssetType.ETH, {
    [multisigOwnerKeys[0].address]: WeiPerEther,
    [multisigOwnerKeys[1].address]: WeiPerEther
  });

  const freeBalanceETH = stateChannel.getFreeBalanceFor(AssetType.ETH);

  targetAppInstance = new AppInstance(
    AddressZero,
    stateChannel.multisigOwners,
    10,
    freeBalanceETH.appInterface,
    freeBalanceETH.terms,
    true,
    5,
    0,
    freeBalanceETH.toJson().latestState,
    freeBalanceETH.toJson().latestNonce,
    freeBalanceETH.timeout
  );

  intermediaryCommitment = new VirtualAppSetStateCommitment(
    network,
    targetAppInstance.identity,
    targetAppInstance.timeout,
    undefined,
    undefined
  );
  intermediarySignature = multisigOwnerKeys[0].signDigest(
    intermediaryCommitment.hashToSign(true)
  );
});

describe("The virtualAppSetState transaction generated by the commitment", () => {
  jest.setTimeout(JEST_TEST_WAIT_TIME);

  it("succeeds", async () => {
    const userCommitment = new VirtualAppSetStateCommitment(
      network,
      targetAppInstance.identity,
      targetAppInstance.timeout,
      targetAppInstance.hashOfLatestState,
      targetAppInstance.nonce
    );
    const userSignature = multisigOwnerKeys[1].signDigest(
      userCommitment.hashToSign(false)
    );

    const txn = userCommitment.transaction(
      [userSignature],
      intermediarySignature
    );

    await wallet.sendTransaction({
      ...txn,
      gasLimit: SETSTATE_COMMITMENT_GAS
    });

    const contractAppState = await appRegistry.appChallenges(
      targetAppInstance.identityHash
    );

    expect(contractAppState.appStateHash).toBe(
      targetAppInstance.hashOfLatestState
    );
  });
  it("fails with nonce above expiry", async () => {
    // the commitment with all the information needed to generate signatures
    // and a transaction
    const fullCommitment = new VirtualAppSetStateCommitment(
      network,
      targetAppInstance.identity,
      targetAppInstance.timeout,
      targetAppInstance.hashOfLatestState,
      EXPIRY_NONCE + 1
    );
    const s1 = multisigOwnerKeys[1].signDigest(
      fullCommitment.hashToSign(false)
    );

    const txn = fullCommitment.transaction([s1], intermediarySignature);

    expect2(true);

    (expect2(
      wallet.sendTransaction({
        ...txn,
        gasLimit: SETSTATE_COMMITMENT_GAS
      })
    ).to.be as any).revertedWith(
      "Tried to call setState with nonce greater than intermediary nonce expiry"
    );
  });
});
