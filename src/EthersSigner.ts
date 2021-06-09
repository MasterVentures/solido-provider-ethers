import { ethers } from 'ethers';
import { CementoSigner } from 'cemento-paid';
import { Wallet } from 'xdvplatform-wallet';



export class EthersSigner implements CementoSigner {
    accepted: any;
    constructor(
        private provider: ethers.providers.Provider,
        private signer: ethers.Wallet,
        private wallet: Wallet,
        private tx: ethers.utils.Transaction) {
    }

    public async canUse() {
        let ticket = null;
        const init = this.accepted;
        return new Promise((resolve) => {
            resolve(true);
            // ticket = setInterval(() => {
            //     if (this.accepted !== init) {
            //         clearInterval(ticket);
            //         resolve(this.accepted);
            //         this.accepted = undefined;
            //         return;
            //     }
            // }, 1000);
        });
    }
    async requestSigning(): Promise<any> {
        const estimate = await this.provider.estimateGas(this.tx);
        this.wallet.onRequestPassphraseSubscriber.next({
            type: 'request_tx',
            payload: {
                tx: this.tx,
                estimate
            }
        });

        const canUseIt = await this.canUse();

        if (canUseIt) {
            const signed = await this.signer.sign(this.tx);
            const resp = await this.provider.sendTransaction(signed);
            await resp.wait(2);
            return true;
        } else {
            return false;
        }
    }
}
