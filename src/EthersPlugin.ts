import { Observable, Subject } from 'rxjs';
import { pluck } from 'rxjs/operators';
import { ethers, Contract, ContractFunction } from 'ethers';
import { IMethodOrEventCall, EventFilter, CementoProviderType, ProviderInstance, CementoProvider, CementoContract, CementoSigner } from 'cemento-paid';
import { EthersSigner } from './EthersSigner';
import { EthersSettings } from './EthersSettings';
import { UncheckedJsonRpcSigner } from './UncheckedSigner';
import { JsonRpcProvider } from 'ethers/providers';
import { Wallet } from 'xdvplatform-wallet'
export type DispatcherArgs = object | [];

export interface MapAction {
    [key: string]: {
        getter: string,
        onFilter: string,
        mutation: string | ((e: DispatcherArgs, contract: EthersPlugin) => any),
    };
}

export interface MapEvent {
    [key: string]: {
        getter: string,
        mutation: string,
    };
}

export interface Mutation {
    [key: string]: (e: DispatcherArgs, contract: EthersPlugin) => any,
}


export interface ReactiveContractStore {
    mapActions?: MapAction,
    mapEvents?: MapEvent,
    mutations: Mutation,
    state: object;
}

export interface ReactiveBindings {
    dispatchEvent(name: string, filter: any[]): () => {};
    subscribe(name: string, callback: () => {}): void;
}
/**
 * EthersPlugin provider for Cemento
 */
export class EthersPlugin extends CementoProvider implements CementoContract, ReactiveBindings {
    chainId: string;
    private provider: ethers.providers.Provider;
    private wallet: ethers.Wallet;
    public network: string;
    private instance: ethers.Contract;
    public defaultAccount: string;
    public address: string;
    private privateKey: string;
    private store: ReactiveContractStore = {
        mapActions: {},
        mapEvents: {},
        mutations: {},
        state: {}
    };
    private _subscriber: Subject<object>;
    public walletProvider: Wallet;
    public getProviderType(): CementoProviderType {
        return CementoProviderType.Ethers;
    }

    describe() {
        return `network: ${this.network}`;
    }
    onReady<T>(settings: T & EthersSettings) {
        const { walletProvider, privateKey, store, provider, network, defaultAccount } = settings;
        this.privateKey = privateKey;
        this.provider = provider;
        this.walletProvider = walletProvider;
        this.network = network;
        this.defaultAccount = defaultAccount;
        this.instance = new ethers.Contract(
            this.bindContract.address,
            this.abi as any,
            provider
        );
        this.address = this.bindContract.address;

        if (walletProvider instanceof Wallet) {
            this.privateKey = walletProvider.getES256K().getPrivate('hex');
        }
        if (privateKey) {
            this.wallet = new ethers.Wallet(privateKey, provider);
            this.instance = new ethers.Contract(
                this.bindContract.address,
                this.abi as any,
                this.wallet,
            );
        }
        if (store) {
            this._subscriber = new Subject();
            this.store = store;

            this._subscriber.subscribe((state) => {
                this.store.state = state;
            });
        }
    }

    public connect(
    ) {

        if (this.walletProvider instanceof Wallet) {
            this.privateKey = this.walletProvider.getES256K().getPrivate('hex');
        }
        if (this.provider && this.network && this.defaultAccount) {
            this.instance = new ethers.Contract(
                this.bindContract.address,
                this.abi as any,
                this.provider
            )
            this.address = this.bindContract.address;
            if (this.privateKey === 'metamask' || this.privateKey === 'provider') {
                const randomwallet = ethers.Wallet.createRandom();
                this.wallet = randomwallet.connect(this.provider);
                const signer = new UncheckedJsonRpcSigner((this.provider as JsonRpcProvider).getSigner());
                this.instance = new ethers.Contract(
                    this.bindContract.address,
                    this.abi as any,
                    signer,
                );
            } else if (this.privateKey) {
                this.wallet = new ethers.Wallet(this.privateKey, this.provider);
                this.instance = new ethers.Contract(
                    this.bindContract.address,
                    this.abi as any,
                    this.wallet,
                );
            }

            if (this.store) {
                this._subscriber = new Subject();
                this._subscriber.subscribe((state) => {
                    this.store.state = state;
                });
            }
        } else {
            throw new Error('Missing onReady settings');
        }
    }

    public setInstanceOptions(settings: ProviderInstance) {
        this.provider = settings.provider;
        if (settings.options.network) {
            this.network = settings.options.network;
        }
        if (settings.options.defaultAccount) {
            this.defaultAccount = settings.options.defaultAccount;
        }
        if (settings.options.privateKey) {
            this.privateKey = settings.options.privateKey;
        }
        if (settings.options.store) {
            this._subscriber = new Subject();
            this.store = settings.options.store;
        }
    }

    /***
     * Dispatches a reactive subscriptio for an event
     * @returns A cancellable ticket
     */
    dispatchEvent(name: string, filter: any[]): () => {} {
        let cancellable = null;
        const mapEvent = this.store.mapEvents[name];
        if (mapEvent) {
            const evt = this.instance.filters[name](...filter);
            const cb = async (...args) => {
                let mutation: any = mapEvent.mutation;
                if (typeof mapEvent.mutation === 'string') {
                    mutation = this.store.mutations[mapEvent.mutation];
                }
                try {
                    const mutateRes = await mutation([...args], this).toPromise();
                    this._subscriber.next({
                        ...this.store.state,
                        [mapEvent.getter]: mutateRes,
                    });
                } catch (e) {
                    console.log('mutation error');
                }
            };
            this.instance.on(evt, cb);
            cancellable = () => {
                this.instance.removeListener(evt, cb);
            }
        }

        return cancellable;
    }

    async prepareSigning(methodCall: any, options: IMethodOrEventCall, args: any[]): Promise<CementoSigner> {
        let gas = options.gas;

        if (!options.gas) gas = 100_000

        // get method instance with args
        const tx: ethers.ContractTransaction = await methodCall(...args, {
            // from:  options.from || this.defaultAccount,
            gasLimit: gas,
            gasPrice: (options as any).gasPrice || 21_000
        });

        const mapActionName = (<any>options).dispatch;
        const mapAction = this.store.mapActions[mapActionName];
        if (mapAction) {
            let evt = this.instance.filters[mapAction.onFilter]();
            if (this.instance.listenerCount(mapAction.onFilter) === 0) {
                this.instance.removeAllListeners(evt);
                this.instance.on(evt, async (...params) => {
                    let mutation: any = mapAction.mutation;
                    if (typeof mapAction.mutation === 'string') {
                        mutation = this.store.mutations[mapAction.mutation];
                    }
                    try {
                        const mutateRes = await mutation([...params], this).toPromise();
                        this._subscriber.next({
                            ...this.store.state,
                            [mapAction.getter]: mutateRes,
                        });
                    } catch (e) {
                        console.log('mutation error');
                    }
                })
            }
        }
        return new EthersSigner(this.provider, this.wallet, this.walletProvider, tx);
    }

    subscribe(key: string, fn: any): void {
        if (Object.keys(this.store.state).find(i => i === key)) {
            this._subscriber.pipe(pluck(key)).subscribe(fn);
        }
    }


    getAbiMethod(name: string): object {
        return this.abi.filter(i => i.name === name)[0];
    }

    callMethod(name: string, args: any[]): any {
        let addr;
        addr = this.bindContract.address;
        const fn: ethers.ContractFunction = this.instance.functions[name];

        return fn(...args);
    }
    /**
     * Gets a Ethers Method object
     * @param name method name
     */
    getMethod(
        name: string,
    ): any {
        return this.instance.functions[name] as ContractFunction;
    }

    /**
     * Gets an event object
     * @param address contract address
     * @param eventAbi event ABI
     */
    getEvent(
        name: string,
    ): any {
        return this.instance.filter[name] as EventFilter<object>;
    }

    public async getEvents<P, T>(name: string, eventFilter?: EventFilter<T & any>): Promise<(P)[]> {
        throw new Error('Use getEvent(eventName) and query using Ethers API');
    }
}
