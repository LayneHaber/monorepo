import { NetworkContext } from "@counterfactual/types";

export function makeNetworkContext(): NetworkContext {
  const preNetworkContext = {} as any;

  const networkContextProps = [
    "AppRegistry",
    "ETHBalanceRefundApp",
    "ETHBucket",
    "MultiSend",
    "NonceRegistry",
    "StateChannelTransaction",
    "ETHVirtualAppAgreement",
    "MinimumViableMultisig",
    "ProxyFactory"
  ];

  const deployedContracts = require("../../networks/8888888.json");

  deployedContracts.forEach((val: any) => {
    const { contractName, address } = val;
    if (networkContextProps.includes(contractName)) {
      preNetworkContext[contractName] = address;
    }
  });

  for (const contractName of networkContextProps) {
    if (!preNetworkContext[contractName]) {
      throw Error(
        `Could not construct network context, ${contractName} not found`
      );
    }
  }

  return preNetworkContext as NetworkContext;
}
