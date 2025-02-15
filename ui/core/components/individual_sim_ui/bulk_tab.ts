import { ContentBlock } from "../content_block";
import { Database } from '../../proto_utils/database';
import { Importer } from "../importers";

import { IndividualSimUI } from "../../individual_sim_ui";
import { TypedEvent } from "../../typed_event";

import { EventID } from '../../typed_event.js';

import { EquipmentSpec, ItemSpec, SimDatabase, SimEnchant, SimGem, SimItem, Spec } from "../../proto/common";
import { BulkComboResult, BulkSettings, ItemSpecWithSlot, ProgressMetrics } from "../../proto/api";

import { ItemRenderer, SelectorModal, SelectorModalTabs } from "../gear_picker";
import { SimTab } from "../sim_tab";

import { UIEnchant, UIGem, UIItem } from "../../proto/ui";
import { Component } from "../component";
import { EquippedItem } from "../../proto_utils/equipped_item";
import { ResultsViewer } from "../results_viewer";

import { Popover, Tooltip } from 'bootstrap';
import { BooleanPicker } from "../boolean_picker";
import { getEligibleItemSlots } from "../../proto_utils/utils";

export class BulkGearJsonImporter<SpecType extends Spec> extends Importer {
  private readonly simUI: IndividualSimUI<SpecType>;
  private readonly bulkUI: BulkTab
  constructor(parent: HTMLElement, simUI: IndividualSimUI<SpecType>, bulkUI: BulkTab) {
    super(parent, simUI, 'Bag Item Import', true);
    this.simUI = simUI;
    this.bulkUI = bulkUI;
    this.descriptionElem.innerHTML = `
      <p>Import bag items from a JSON file, which can be created by the WowSimsExporter in-game AddOn.</p>
      <p>To import, upload the file or paste the text below, then click, 'Import'.</p>
    `;
  }

  async onImport(data: string) {
    try {
      const equipment = EquipmentSpec.fromJsonString(data, { ignoreUnknownFields: true });
      if (equipment?.items?.length > 0) {
        const db = await Database.loadLeftoversIfNecessary(equipment);
        const items = equipment.items.filter((spec) => spec.id > 0);
        if (items.length > 0) {
          for (const itemSpec of items) {
            if (itemSpec.id == 0) {
              continue;
            }
            if (!db.lookupItemSpec(itemSpec)) {
              throw new Error("cannot find item with ID " + itemSpec.id);
            }
          }
          this.bulkUI.importItems(items);
        }
      }
      this.close();
    } catch (e: any) {
      alert(e.toString());
    }
  }
}

class BulkSimResultRenderer {

  constructor(parent: ContentBlock, simUI: IndividualSimUI<Spec>, result: BulkComboResult, rank: number, baseResult: BulkComboResult) {
    if (parent.headerElement) {
      parent.headerElement.innerHTML = `Rank ${rank}`;
    }

    const dpsDivParent = document.createElement('div');
    dpsDivParent.classList.add('results-sim');
    parent.bodyElement.appendChild(dpsDivParent);

    const dpsDiv = document.createElement('div');
    dpsDiv.classList.add('bulk-result-body-dps', 'bulk-items-text-line', 'results-sim-dps', 'damage-metrics');
    dpsDivParent.appendChild(dpsDiv);
    
    const dpsNumber = document.createElement('span');
    dpsNumber.textContent = this.formatDps(result.unitMetrics?.dps?.avg!);
    dpsNumber.classList.add('topline-result-avg');
    dpsDiv.appendChild(dpsNumber);

    const dpsDelta = result.unitMetrics?.dps?.avg! - baseResult.unitMetrics?.dps?.avg!;
    const dpsDeltaSpan = document.createElement('span'); 
    dpsDeltaSpan.textContent = `${this.formatDpsDelta(dpsDelta)}`;
    dpsDeltaSpan.classList.add(dpsDelta >= 0 ? 'bulk-result-header-positive' : 'bulk-result-header-negative');
    dpsDiv.appendChild(dpsDeltaSpan);

    const itemsContainer = document.createElement('div');
    itemsContainer.classList.add('bulk-gear-combo');
    parent.bodyElement.appendChild(itemsContainer);

    if (result.itemsAdded && result.itemsAdded.length > 0) {
      for (const is of result.itemsAdded) {
        const item = simUI.sim.db.lookupItemSpec(is.item!)
        const renderer = new ItemRenderer(itemsContainer, simUI.player);
        renderer.update(item!);
  
        const p = document.createElement('a');
        p.classList.add('bulk-result-item-slot');
        p.textContent = this.itemSlotName(is);
        renderer.nameElem.appendChild(p); 
      }
    } else {
      const p = document.createElement('p');
      p.textContent = 'No changes - this is your currently equipped gear!';
      parent.bodyElement.appendChild(p);
      dpsDeltaSpan.textContent = '';
    }
  }

  private formatDps(dps: number): string {
    return (Math.round(dps * 100) / 100).toFixed(2);
  }

  private formatDpsDelta(delta: number): string {
    return ((delta >= 0) ? "+" : "") + this.formatDps(delta); 
  }

  private itemSlotName(is: ItemSpecWithSlot): string {
    return JSON.parse(ItemSpecWithSlot.toJsonString(is, {emitDefaultValues: true}))['slot'].replace('ItemSlot', '')
  }
}

export class BulkItemPicker extends Component {
  private readonly itemElem: ItemRenderer;
  readonly simUI: IndividualSimUI<Spec>;
  readonly bulkUI: BulkTab;
  readonly index: number;

  protected item: EquippedItem;
  
  constructor(parent: HTMLElement, simUI: IndividualSimUI<Spec>, bulkUI: BulkTab, item: EquippedItem, index: number) {
    super(parent, 'bulk-item-picker');
    this.simUI = simUI;
    this.bulkUI = bulkUI;
    this.index = index;
    this.item = item;
    this.itemElem = new ItemRenderer(this.rootElem, simUI.player);
    
    this.simUI.sim.waitForInit().then(() => {
      this.setItem(item);
      const slot = getEligibleItemSlots(this.item.item)[0];
      const eligibleEnchants = this.simUI.sim.db.getEnchants(slot);
      const openEnchantGemSelector = (event: Event) => {
        event.preventDefault();
        const changeEvent = new TypedEvent<void>();
        const modal = new SelectorModal(this.bulkUI.rootElem, this.simUI, this.simUI.player, {
          selectedTab: SelectorModalTabs.Enchants,
          slot: slot,
          equippedItem: this.item,
          eligibleItems: new Array<UIItem>(),
          eligibleEnchants: eligibleEnchants,
          gearData: {
            equipItem: (eventID: EventID, equippedItem: EquippedItem | null) => {
              if (equippedItem) {
                const otherItems = this.bulkUI.getItems();
                otherItems[this.index] = equippedItem.asSpec();
                this.item = equippedItem;
                this.bulkUI.importItems(otherItems);
                changeEvent.emit(TypedEvent.nextEventID());
              }
            },
            getEquippedItem: () => this.item,
            changeEvent: changeEvent,
          }
        });

        const removeButton = modal.body.querySelector('.selector-modal-remove-button');
        if (removeButton && removeButton.parentNode) {
          const destroyItemButton = document.createElement('button');
          destroyItemButton.textContent = 'Destroy Item';
          destroyItemButton.classList.add('btn', 'btn-danger');
          destroyItemButton.onclick = () => {
            const needle = this.item.asSpec();
            bulkUI.importItems(bulkUI.getItems().filter((spec) => { return !ItemSpec.equals(spec, needle); }));
            modal.close();
          };
          removeButton.parentNode.appendChild(destroyItemButton);
        }
      };

      const onClickEnd = (event: Event) => {
        event.preventDefault();
      };

      // Make icon open gear selector
      this.itemElem.iconElem.addEventListener('click', openEnchantGemSelector);
      this.itemElem.iconElem.addEventListener('touchstart', openEnchantGemSelector);
      this.itemElem.iconElem.addEventListener('touchend', onClickEnd);

      // Make item name open gear selector
      this.itemElem.nameElem.addEventListener('click', openEnchantGemSelector);
      this.itemElem.nameElem.addEventListener('touchstart', openEnchantGemSelector);
      this.itemElem.nameElem.addEventListener('touchend', onClickEnd);

      this.itemElem.enchantElem.addEventListener('click', openEnchantGemSelector);
      this.itemElem.enchantElem.addEventListener('touchstart', openEnchantGemSelector);
      this.itemElem.enchantElem.addEventListener('touchend', onClickEnd);
    });
  }

  setItem(newItem: EquippedItem | null) {
    this.itemElem.clear();
    if (newItem != null) {
      this.itemElem.update(newItem);
      this.item = newItem;
    } else {
      this.itemElem.rootElem.style.opacity = '30%';
      this.itemElem.iconElem.style.backgroundImage = `url('/wotlk/assets/item_slots/empty.jpg')`;
      this.itemElem.nameElem.textContent = 'Add new item (not implemented)';
      this.itemElem.rootElem.style.alignItems = 'center';
    }
  }
}

export class BulkTab extends SimTab {
  readonly simUI: IndividualSimUI<Spec>;
  
  readonly itemsChangedEmitter = new TypedEvent<void>();

  readonly leftPanel: HTMLElement;
  readonly rightPanel: HTMLElement;

  readonly column1: HTMLElement = this.buildColumn(1, 'raid-settings-col');

  protected items: Array<ItemSpec> = new Array<ItemSpec>();

  private pendingResults: ResultsViewer;
  private pendingDiv: HTMLDivElement;

  // TODO: Make a real options probably
  private doCombos: boolean;
  private fastMode: boolean;

  constructor(parentElem: HTMLElement, simUI: IndividualSimUI<Spec>) {
    super(parentElem, simUI, {identifier: 'bulk-tab', title: 'Bulk'});
    this.simUI = simUI;

    this.leftPanel = document.createElement('div');
    this.leftPanel.classList.add('bulk-tab-left', 'tab-panel-left');
    this.leftPanel.appendChild(this.column1);

    this.rightPanel = document.createElement('div');
    this.rightPanel.classList.add('bulk-tab-right', 'tab-panel-right');

    this.pendingDiv = document.createElement('div');
    this.pendingDiv.classList.add("results-pending-overlay");
    this.pendingResults = new ResultsViewer(this.pendingDiv);
    this.pendingResults.hideAll();

    this.contentContainer.appendChild(this.leftPanel);
    this.contentContainer.appendChild(this.rightPanel);
    this.contentContainer.appendChild(this.pendingDiv);

    this.doCombos = true;
    this.fastMode = false;
    this.buildTabContent();
  }

  protected createBulkSettings(): BulkSettings {
    return BulkSettings.create({
      items: this.items,

      // TODO(Riotdog-GehennasEU): Make all of these configurable.
      // For now, it's always constant iteration combinations mode for "sim my bags".
      combinations: this.doCombos,
      fastMode: this.fastMode,
      autoEnchant: false,
      autoGem: false,
      iterationsPerCombo: this.simUI.sim.getIterations(), // TODO(Riotdog-GehennasEU): Define a new UI element for the iteration setting.
    });
  }

  protected createBulkItemsDatabase(): SimDatabase {
    const itemsDb = SimDatabase.create();
    for (const is of this.items) {
      const item = this.simUI.sim.db.lookupItemSpec(is)
      if (!item) {
        throw new Error(`item with ID ${is.id} not found in database`);
      }
      itemsDb.items.push(SimItem.fromJson(UIItem.toJson(item.item), { ignoreUnknownFields: true }))
      if (item.enchant) {
        itemsDb.enchants.push(SimEnchant.fromJson(UIEnchant.toJson(item.enchant), { ignoreUnknownFields: true }));
      }
      for (const gem of item.gems) {
        if (gem) {
          itemsDb.gems.push(SimGem.fromJson(UIGem.toJson(gem), { ignoreUnknownFields: true }));
        }
      }
    }
    return itemsDb;
  }

  importItems(items: Array<ItemSpec>) {
    this.items = items;
    this.itemsChangedEmitter.emit(TypedEvent.nextEventID());
  }

  getItems(): Array<ItemSpec> {
    const result = new Array<ItemSpec>();
    this.items.forEach((spec) => { result.push(ItemSpec.clone(spec)); });
    return result;
  }

  setCombinations(doCombos: boolean) {
    this.doCombos = doCombos;
    this.itemsChangedEmitter.emit(TypedEvent.nextEventID());
  }

  setFastMode(fastMode: boolean) {
    this.fastMode = fastMode;
    this.itemsChangedEmitter.emit(TypedEvent.nextEventID());
  }

  protected async runBulkSim(onProgress: Function) {
    this.pendingResults.setPending();

    try {
      await this.simUI.sim.runBulkSim(this.createBulkSettings(), this.createBulkItemsDatabase(), onProgress);
    } catch (e) {
      this.simUI.handleCrash(e);
    }
  }

  protected buildTabContent() {
    const itemsBlock = new ContentBlock(this.column1, 'bulk-items', {
      header: {title: 'Items'}
    });

    itemsBlock.bodyElement.classList.add('gear-picker-root');

    const noticeWorkInProgress = document.createElement('div');
    noticeWorkInProgress.classList.add('bulk-items-text-line');
    itemsBlock.bodyElement.appendChild(noticeWorkInProgress);
    noticeWorkInProgress.innerHTML = '<i>Notice: This is under very early but active development and experimental. You may also need to update your WoW AddOn if you want to import your bags.</i>'

    const itemTextIntro = document.createElement('div');
    itemTextIntro.classList.add('bulk-items-text-line');
    itemsBlock.bodyElement.appendChild(itemTextIntro);

    const itemList = document.createElement('div');

    itemList.classList.add('tab-panel-col', 'bulk-gear-combo');
    itemsBlock.bodyElement.appendChild(itemList);
    
    this.itemsChangedEmitter.on(() => {
      itemList.innerHTML = '';
      if (this.items.length > 0) {
        itemTextIntro.textContent = 'The following items will be simmed in all possible combinations together with your equipped gear.';
        for (let i = 0; i < this.items.length; ++i) {
          const spec = this.items[i];
          const item = this.simUI.sim.db.lookupItemSpec(spec);
          const bulkItemPicker = new BulkItemPicker(itemList, this.simUI, this, item!, i);
        }
      }
    });

    this.importItems(new Array<ItemSpec>());

    let resultsBlock = new ContentBlock(this.column1, 'bulk-results', {header: {
      title: 'Results',
      extraCssClasses: ['bulk-results-header'],
    }});

    resultsBlock.rootElem.hidden = true;
    resultsBlock.bodyElement.classList.add('gear-picker-root', 'tab-panel-col');
    
    this.simUI.sim.bulkSimStartEmitter.on(() => {
      resultsBlock.rootElem.hidden = true;
    });

    this.simUI.sim.bulkSimResultEmitter.on((_, bulkSimResult) => {
      resultsBlock.rootElem.hidden = bulkSimResult.results.length == 0;
      resultsBlock.bodyElement.innerHTML = '';

      let rank = 1;
      for (const r of bulkSimResult.results) {
        const resultBlock = new ContentBlock(resultsBlock.bodyElement, 'bulk-result', {header: {title: ''}});
        new BulkSimResultRenderer(resultBlock, this.simUI, r, rank, bulkSimResult.equippedGearResult!);
        rank++;
      }
    });

    const settingsBlock = new ContentBlock(this.rightPanel, 'bulk-settings', {
      header: {title: 'Import'}
    });

    const importButton = document.createElement('button');
    importButton.classList.add('btn', 'btn-primary', 'w-100', 'bulk-settings-button');
    importButton.innerHTML = '<i class="fa fa-download"></i> Import From Bags';
    importButton.addEventListener('click', () => new BulkGearJsonImporter(this.simUI.rootElem, this.simUI, this));
    settingsBlock.bodyElement.appendChild(importButton);

    const bulkSimButton = document.createElement('button');
    bulkSimButton.classList.add('btn', 'btn-primary', 'w-100', 'bulk-settings-button');
    bulkSimButton.textContent = 'Run Bulk Sim';
    bulkSimButton.addEventListener('click', () => {

      this.pendingDiv.style.display = "flex";
      this.leftPanel.classList.add("blurred");
      this.rightPanel.classList.add("blurred");

      const previousContents = bulkSimButton.innerHTML;
      bulkSimButton.disabled = true;
      bulkSimButton.classList.add(".disabled");
      bulkSimButton.innerHTML = `<i class="fa fa-spinner fa-spin"></i>&nbsp;Running`;


      let simStart = new Date().getTime();
      let lastTotal = 0;
      let rounds = 0;
      let currentRound = 0;
      let combinations = 0;

      this.runBulkSim((progressMetrics: ProgressMetrics) => {
        console.log(progressMetrics);

        const msSinceStart = new Date().getTime() - simStart;
        const iterPerSecond = progressMetrics.completedIterations / (msSinceStart/1000);

        if (combinations == 0) {
          combinations = progressMetrics.totalSims;
        }
        if (this.fastMode) {
          if (rounds == 0 && progressMetrics.totalSims > 0) {
            rounds = Math.ceil(Math.log(progressMetrics.totalSims/20) / Math.log(2)) + 1;
            currentRound = 1;
          }
          if (progressMetrics.totalSims < lastTotal) {
            currentRound += 1;
            simStart = new Date().getTime();
          }
        }

        this.setSimProgress(progressMetrics, iterPerSecond, currentRound, rounds, combinations);
        lastTotal = progressMetrics.totalSims;

        if (progressMetrics.finalBulkResult != null) {  
          // reset state
          this.pendingDiv.style.display = "none";
          this.leftPanel.classList.remove("blurred");
          this.rightPanel.classList.remove("blurred");
    
          this.pendingResults.hideAll();
          bulkSimButton.disabled = false;
          bulkSimButton.classList.remove(".disabled");
          bulkSimButton.innerHTML = previousContents;    
        }
      });
    });

    settingsBlock.bodyElement.appendChild(bulkSimButton);

    const clearButton = document.createElement('button');
    clearButton.classList.add('btn', 'btn-primary', 'w-100', 'bulk-settings-button');
    clearButton.textContent = 'Clear All';
    clearButton.addEventListener('click', () => {
      this.importItems(new Array<ItemSpec>());
      resultsBlock.rootElem.hidden = true;
      resultsBlock.bodyElement.innerHTML = '';
    });
    settingsBlock.bodyElement.appendChild(clearButton);

    new BooleanPicker<BulkTab>(settingsBlock.bodyElement, this, {
      label: "Fast Mode",
      labelTooltip: "Fast mode reduces accuracy but will run faster.",
      changedEvent: (obj: BulkTab) => this.itemsChangedEmitter,
      getValue: (obj) => this.fastMode,
      setValue: (id: EventID, obj: BulkTab, value: boolean) => {obj.fastMode = value}
    });
    new BooleanPicker<BulkTab>(settingsBlock.bodyElement, this, {
      label: "Combinations",
      labelTooltip: "When checked bulk simulator will create all possible combinations of the items. When disabled trinkets and rings will still run all combinations becausee they have two slots to fill each.",
      changedEvent: (obj: BulkTab) => this.itemsChangedEmitter,
      getValue: (obj) => this.doCombos,
      setValue: (id: EventID, obj: BulkTab, value: boolean) => {obj.doCombos = value}
    });
  }

  private setSimProgress(progress: ProgressMetrics, iterPerSecond: number, currentRound: number, rounds: number, combinations: number) {
    const secondsRemain = ((progress.totalIterations - progress.completedIterations) / iterPerSecond).toFixed();

    let roundsText = "";
    if (rounds > 0) {
      roundsText = `${currentRound} / ${rounds} refining rounds`;
    }

    this.pendingResults.setContent(`
      <div class="results-sim">
        <div class="">${combinations} total combinations.</div>
        <div class="">${roundsText}</div>
        <div class=""> ${progress.completedSims} / ${progress.totalSims}<br>simulations complete</div>
        <div class="">
          ${progress.completedIterations} / ${progress.totalIterations}<br>iterations complete
        </div>
        <div class="">
          ${secondsRemain} seconds remaining.
        </div>
      </div>
    `);
  }
}
