// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { t } from './i18n'
import ChannelsPage from './channels-page'
import InboundQueueTab from './inbound-queue-tab'
import PairingTab from './pairing-tab'
import { ContextualHelp } from '@/components/docs/contextual-help'

export default function CommunicationPage() {
  return (
    <div>
      <h1 className="page-title mb-4">{t('communication.title')} <ContextualHelp helpId="communication.channels" /></h1>
      <Tabs defaultValue="channels">
        <TabsList className="mb-5">
          <TabsTrigger value="channels">{t('communication.tabs.channels')}</TabsTrigger>
          <TabsTrigger value="inbound">{t('communication.tabs.inbound')}</TabsTrigger>
          <TabsTrigger value="pairing">{t('communication.tabs.pairing')}</TabsTrigger>
        </TabsList>
        <TabsContent value="channels">
          <ChannelsPage />
        </TabsContent>
        <TabsContent value="inbound">
          <InboundQueueTab />
        </TabsContent>
        <TabsContent value="pairing">
          <PairingTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
